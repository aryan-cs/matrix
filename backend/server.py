from __future__ import annotations
import csv
import io
import json
import os
import re
import asyncio
import urllib.error
import urllib.request
import subprocess
import time
import socket
import tempfile
import threading
from pathlib import Path
from typing import Any

try:
    from network_builder import (
        app as delegated_api_app,
        build_social_graph,
        GraphBuildResponse,
        GraphNode,
        GraphEdge,
        GraphStats,
    )
except (ImportError, AttributeError):
    from backend.network_builder import (
        app as delegated_api_app,
        build_social_graph,
        GraphBuildResponse,
        GraphNode,
        GraphEdge,
        GraphStats,
    )

import modal
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# --- MODAL CONFIGURATION ---
APP_NAME = "deepseek-r1-1p5b"
MODEL_ID = "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"
MODEL_DIR = "/model"
VOLUME_NAME = "deepseek-r1-1p5b-weights"
VLLM_PORT = 8000
INSTANCE_COUNT = 20
TARGET_TOTAL_CONCURRENCY = 100
MAX_INPUTS_PER_INSTANCE = (TARGET_TOTAL_CONCURRENCY + INSTANCE_COUNT - 1) // INSTANCE_COUNT

image = (
    modal.Image.from_registry("nvidia/cuda:12.8.0-devel-ubuntu22.04", add_python="3.12")
    .entrypoint([])
    .pip_install("vllm==0.8.5", "huggingface-hub==0.30.2", "hf-transfer>=0.1.8")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .add_local_python_source("network_builder")
)

# Modal App Instance
modal_app = modal.App(APP_NAME)
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

# --- FASTAPI CONFIGURATION ---
# Renamed to web_app to prevent Uvicorn from crashing
web_app = FastAPI(
    title="Matrix Backend API",
    version="0.1.0",
    description="CSV-to-social-graph construction APIs for representative agent simulations.",
)

web_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- GRAPH LOGIC & MODELS ---
REQUIRED_COLUMNS = {"agent_id", "connections", "system_prompt"}
CONNECTION_SPLIT_PATTERN = re.compile(r"[|;,]")

class GraphBuildRequest(BaseModel):
    csv_text: str = Field(..., min_length=1)
    directed: bool = False

# ... (Keep your GraphNode, GraphEdge, GraphStats, GraphBuildResponse, PlannerContextResponse classes here)


class LiveWhisperService:
    """Lazy model loader for low-latency streaming transcription."""

    def __init__(self) -> None:
        self._model = None
        self._model_init_lock = threading.Lock()

    def _ensure_model(self):
        if self._model is not None:
            return self._model
        with self._model_init_lock:
            if self._model is not None:
                return self._model
            try:
                from faster_whisper import WhisperModel
            except Exception as error:
                raise RuntimeError(
                    "faster-whisper is not installed. Run `uv sync` in backend/ first."
                ) from error

            model_id = os.getenv("WHISPER_MODEL_ID", "large-v3-turbo").strip() or "large-v3-turbo"
            device = os.getenv("WHISPER_DEVICE", "auto").strip() or "auto"
            compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8").strip() or "int8"

            self._model = WhisperModel(model_id, device=device, compute_type=compute_type)
            return self._model

    @staticmethod
    def _suffix_for_mime_type(mime_type: str | None) -> str:
        normalized = (mime_type or "").lower()
        if "webm" in normalized:
            return ".webm"
        if "mp4" in normalized or "m4a" in normalized:
            return ".m4a"
        if "wav" in normalized:
            return ".wav"
        if "ogg" in normalized or "opus" in normalized:
            return ".ogg"
        return ".webm"

    def transcribe_audio_bytes(
        self,
        audio_bytes: bytes,
        language: str | None = None,
        mime_type: str | None = None,
    ) -> str:
        model = self._ensure_model()
        if not audio_bytes:
            return ""
        suffix = self._suffix_for_mime_type(mime_type)
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as temp_audio:
            temp_audio.write(audio_bytes)
            temp_audio.flush()
            segments, _ = model.transcribe(
                temp_audio.name,
                language=language or None,
                beam_size=1,
                temperature=0.0,
                vad_filter=False,
                condition_on_previous_text=False,
                without_timestamps=True,
            )
            text_parts = []
            for segment in segments:
                piece = str(getattr(segment, "text", "") or "").strip()
                if piece:
                    text_parts.append(piece)
            return " ".join(text_parts).strip()


live_whisper_service = LiveWhisperService()


@web_app.on_event("startup")
async def warm_live_whisper_model():
    if os.getenv("WHISPER_PREWARM", "true").strip().lower() in {"0", "false", "no"}:
        return
    try:
        await asyncio.to_thread(live_whisper_service._ensure_model)
    except Exception as error:
        # Do not fail API startup if prewarm fails; endpoint will still error with detail.
        print(f"[speech-live] Whisper prewarm skipped: {error}")

# --- MODAL FUNCTIONS ---
@modal_app.function(
    image=image,
    volumes={MODEL_DIR: volume},
    timeout=7200,
)
def download_model():
    import os
    from huggingface_hub import snapshot_download

    print(f"🚀 Starting forced download of {MODEL_ID}...")
    
    # local_dir_use_symlinks=False is CRITICAL for Modal Volumes
    snapshot_download(
        MODEL_ID, 
        local_dir=MODEL_DIR,
        local_dir_use_symlinks=False, 
        ignore_patterns=["*.msgpack", "*.h5"],
        force_download=True 
    )
    
    # Log the contents to be 100% sure
    files = os.listdir(MODEL_DIR)
    print(f"📂 Files in {MODEL_DIR}: {files}")
    
    if "config.json" in files:
        print("✅ Weights verified. Committing volume...")
        volume.commit()
    else:
        print("❌ Error: Download finished but config.json is missing.")
        
@modal_app.cls(
    image=image,
    gpu="A100-80GB:1", # Keep A100 for high performance
    volumes={MODEL_DIR: volume},
    timeout=3600,
    scaledown_window=300,
    min_containers=INSTANCE_COUNT, # Maintains 10 warm instances
    max_containers=INSTANCE_COUNT, # Fixed at 10 for your scale
)
@modal.concurrent(max_inputs=MAX_INPUTS_PER_INSTANCE) # 10 inputs per instance
class DeepSeekServer:
    @modal.enter()
    def start_server(self):
        cmd = [
            "vllm", "serve", MODEL_DIR,
            "--served-model-name", "deepseek-r1",
            "--tensor-parallel-size", "1",
            "--host", "0.0.0.0",
            "--port", str(VLLM_PORT),
            "--max-model-len", "8192",
            "--gpu-memory-utilization", "0.85",
            "--enforce-eager",
            "--trust-remote-code",
        ]
        self._proc = subprocess.Popen(cmd)
        for _ in range(600):
            try:
                s = socket.create_connection(("127.0.0.1", VLLM_PORT), timeout=1)
                s.close()
                return
            except OSError:
                time.sleep(1)

    @modal.exit()
    def stop_server(self):
        self._proc.terminate()

    @modal.web_server(port=VLLM_PORT, startup_timeout=600)
    def openai_server(self):
        pass

# --- FASTAPI ENDPOINTS ---
# Updated to use @web_app decorator
@web_app.get("/health")
async def health():
    return {"status": "ok"}

@web_app.post("/api/graph/from-csv-file")
async def graph_from_csv_file(file: UploadFile = File(...), directed: bool = False):
    content = await file.read()
    csv_text = content.decode("utf-8")
    # This calls your build_social_graph function
    return build_social_graph(csv_text, directed=directed)


@web_app.websocket("/api/speech/live")
async def speech_live(websocket: WebSocket):
    await websocket.accept()
    latest_audio_snapshot = b""
    last_text_sent = ""
    language = (os.getenv("WHISPER_LANGUAGE", "").strip() or None)
    mime_type = "audio/webm"
    has_pending_snapshot = False
    transcribe_task: asyncio.Task | None = None

    async def transcribe_snapshot(is_final: bool = False) -> str:
        nonlocal last_text_sent
        if not latest_audio_snapshot:
            return ""
        transcript = await asyncio.to_thread(
            live_whisper_service.transcribe_audio_bytes,
            latest_audio_snapshot,
            language,
            mime_type,
        )
        if is_final:
            await websocket.send_json(
                {
                    "type": "final",
                    "text": transcript,
                    "is_final": True,
                }
            )
            return transcript

        if transcript != last_text_sent:
            last_text_sent = transcript
            await websocket.send_json(
                {
                    "type": "partial",
                    "text": transcript,
                    "is_final": False,
                }
            )
        return transcript

    async def transcribe_loop():
        nonlocal has_pending_snapshot, transcribe_task
        try:
            while True:
                has_pending_snapshot = False
                await transcribe_snapshot(is_final=False)
                if not has_pending_snapshot:
                    break
        finally:
            transcribe_task = None

    try:
        while True:
            packet = await websocket.receive()
            incoming_audio = packet.get("bytes")
            incoming_text = packet.get("text")

            if isinstance(incoming_audio, (bytes, bytearray)):
                latest_audio_snapshot = bytes(incoming_audio)
                if not latest_audio_snapshot:
                    continue
                has_pending_snapshot = True
                if transcribe_task is None:
                    transcribe_task = asyncio.create_task(transcribe_loop())
                continue

            if isinstance(incoming_text, str):
                parsed_text = incoming_text.strip()
                if parsed_text.lower() == "finalize":
                    if transcribe_task is not None:
                        await transcribe_task
                    await transcribe_snapshot(is_final=True)
                    await websocket.close()
                    return

                if parsed_text.startswith("{"):
                    try:
                        payload = json.loads(parsed_text)
                    except Exception:
                        payload = {}
                    if isinstance(payload, dict) and payload.get("type") == "config":
                        configured_mime = str(payload.get("mime_type") or "").strip()
                        if configured_mime:
                            mime_type = configured_mime
                        await websocket.send_json(
                            {"type": "ready", "mime_type": mime_type}
                        )
                        continue

                has_pending_snapshot = True
                if transcribe_task is None:
                    transcribe_task = asyncio.create_task(transcribe_loop())
    except WebSocketDisconnect:
        return
    except Exception as error:
        try:
            await websocket.send_json({"type": "error", "error": str(error)})
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass

# ... (Include build_social_graph and other helper functions from your previous code)

# Delegate all other API routes (including /api/simulation/*) to network_builder.
web_app.mount("/", delegated_api_app)

@modal_app.local_entrypoint()
def main():
    print("Modal app is ready. Use 'uvicorn server:web_app' to start the local API.")

# Export FastAPI app for ASGI hosts (Vercel/Render/etc.)
app = web_app

# Keep Modal app accessible explicitly when needed (e.g. `modal deploy server.py::modal_application`)
modal_application = modal_app
