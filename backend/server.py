from __future__ import annotations
import csv
import io
import json
import os
import re
import urllib.error
import urllib.request
import subprocess
import time
import socket
from pathlib import Path
from typing import Any
# Add this at the top of server.py
from network_builder import build_social_graph, GraphBuildResponse, GraphNode, GraphEdge, GraphStats

import modal
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# --- MODAL CONFIGURATION ---
APP_NAME = "deepseek-r1-1p5b"
MODEL_ID = "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"
MODEL_DIR = "/model"
VOLUME_NAME = "deepseek-r1-1p5b-weights"
VLLM_PORT = 8000
INSTANCE_COUNT = 10
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

# ... (Include build_social_graph and other helper functions from your previous code)

@modal_app.local_entrypoint()
def main():
    print("Modal app is ready. Use 'uvicorn server:web_app' to start the local API.")

app = modal_app  # Alias for Modal deployment