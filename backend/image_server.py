"""
Modal image server for OpenAI-compatible image generation.

Deploy:
  modal deploy backend/image_server.py

Resulting endpoint:
  POST https://<workspace>--<app-name>-openai-images.modal.run/v1/images/generations
"""

from __future__ import annotations

import base64
import io
import os
import time
from typing import Literal

import modal
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

APP_NAME = os.getenv("MODAL_IMAGE_APP_NAME", "sdxl-openai-images")
MODEL_ID = os.getenv("PORTRAITS_IMAGE_MODEL", "stabilityai/stable-diffusion-xl-base-1.0")
GPU = os.getenv("MODAL_IMAGE_GPU", "A10G")
CACHE_DIR = "/cache"
VOLUME_NAME = os.getenv("MODAL_IMAGE_VOLUME", "sdxl-model-cache")
MAX_SIDE = int(os.getenv("MODAL_IMAGE_MAX_SIDE", "1344"))

image = (
    modal.Image.debian_slim(python_version="3.10")
    .pip_install(
        "fastapi==0.115.0",
        "pydantic==2.10.6",
        "diffusers==0.30.3",
        "transformers==4.44.2",
        "accelerate==0.33.0",
        "safetensors==0.4.5",
        "torch==2.4.1",
        "pillow==10.4.0",
    )
    .env({"HF_HOME": CACHE_DIR})
)

app = modal.App(APP_NAME)
cache_volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

web_app = FastAPI(title="OpenAI-Compatible Image Server", version="0.1.0")
_pipe = None


class ImageGenerationRequest(BaseModel):
    model: str = Field(default=MODEL_ID)
    prompt: str = Field(..., min_length=1)
    size: str = Field(default="1024x1024")
    response_format: Literal["b64_json"] = "b64_json"
    output_format: Literal["png", "webp", "jpeg"] = "webp"
    n: int = Field(default=1, ge=1, le=1)


def _parse_size(size: str) -> tuple[int, int]:
    raw = str(size or "").strip().lower()
    if "x" not in raw:
        raise ValueError("size must be WIDTHxHEIGHT, e.g. 1024x1024")
    left, right = raw.split("x", 1)
    width = int(left)
    height = int(right)
    if width < 256 or height < 256:
        raise ValueError("width and height must each be >= 256")
    if width > MAX_SIDE or height > MAX_SIDE:
        raise ValueError(f"width and height must each be <= {MAX_SIDE}")
    if width % 8 != 0 or height % 8 != 0:
        raise ValueError("width and height must be multiples of 8")
    return width, height


@web_app.on_event("startup")
def _startup() -> None:
    global _pipe
    if _pipe is not None:
        return

    import torch
    from diffusers import AutoPipelineForText2Image

    pipe = AutoPipelineForText2Image.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.float16,
        use_safetensors=True,
        variant="fp16",
    )
    pipe.to("cuda")
    pipe.set_progress_bar_config(disable=True)
    pipe.enable_attention_slicing()
    _pipe = pipe


@web_app.post("/v1/images/generations")
def generate_images(payload: ImageGenerationRequest) -> dict:
    if payload.model.strip() != MODEL_ID:
        raise HTTPException(
            status_code=400,
            detail=f"This server only hosts model '{MODEL_ID}'. Received '{payload.model}'.",
        )

    try:
        width, height = _parse_size(payload.size)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if _pipe is None:
        raise HTTPException(status_code=503, detail="Model is still loading. Please retry.")

    try:
        image = _pipe(
            prompt=payload.prompt,
            width=width,
            height=height,
            num_inference_steps=30,
            guidance_scale=7.0,
        ).images[0]
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Image generation failed: {exc}") from exc

    buf = io.BytesIO()
    save_format = "JPEG" if payload.output_format == "jpeg" else payload.output_format.upper()
    save_kwargs = {"quality": 95} if payload.output_format in {"jpeg", "webp"} else {}
    image.save(buf, format=save_format, **save_kwargs)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    return {
        "created": int(time.time()),
        "data": [{"b64_json": b64}],
    }


@app.function(
    image=image,
    gpu=GPU,
    timeout=60 * 60,
    scaledown_window=300,
    volumes={CACHE_DIR: cache_volume},
)
@modal.asgi_app()
def openai_images_app():
    return web_app
