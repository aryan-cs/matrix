"""
GLM-5 on Modal — served via vLLM with an OpenAI-compatible API.

Usage:
  # one-time: download weights into a Modal Volume
  modal run serve.py::download_model

  # deploy the inference server
  modal deploy serve.py

  # or run ephemerally (stays up until you Ctrl-C)
  modal serve serve.py
"""

import modal

APP_NAME = "glm-5"
MODEL_ID = "zai-org/GLM-5"
MODEL_DIR = "/model"
VOLUME_NAME = "glm-5-weights"

# ---------------------------------------------------------------------------
# Container image
# ---------------------------------------------------------------------------
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "vllm>=0.8.0",
        "hf-transfer>=0.1.8",
        "huggingface_hub[hf_transfer]>=0.24.0",
        "fastapi>=0.115.0",
        "uvicorn>=0.30.0",
    )
    .env(
        {
            "HF_HUB_ENABLE_HF_TRANSFER": "1",
            # suppress tokenizer parallelism warnings inside vLLM workers
            "TOKENIZERS_PARALLELISM": "false",
        }
    )
)

app = modal.App(APP_NAME)

# Persistent volume — weights survive across runs so you only download once.
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

# ---------------------------------------------------------------------------
# Step 1: download weights  (run once:  modal run serve.py::download_model)
# ---------------------------------------------------------------------------
@app.function(
    image=image,
    volumes={MODEL_DIR: volume},
    timeout=7200,           # 2 h — the full model is ~600 GB
    cpu=8,
    memory=32768,           # 32 GB RAM for the download worker
)
def download_model(hf_token: str = ""):
    """Download Kimi K2.5 weights from HuggingFace into the Modal Volume."""
    from huggingface_hub import snapshot_download
    import os

    kwargs = dict(local_dir=MODEL_DIR, ignore_patterns=["*.pt", "original/*"])
    if hf_token:
        kwargs["token"] = hf_token
    elif os.environ.get("HF_TOKEN"):
        kwargs["token"] = os.environ["HF_TOKEN"]

    print(f"Downloading {MODEL_ID} → {MODEL_DIR} …")
    snapshot_download(MODEL_ID, **kwargs)
    volume.commit()
    print("Done. Weights committed to volume.")


# ---------------------------------------------------------------------------
# Step 2: serve  (modal deploy serve.py  OR  modal serve serve.py)
# ---------------------------------------------------------------------------
@app.cls(
    image=image,
    gpu="A100-80GB:8",      # 8× A100 80 GB — GLM-5 needs ~640 GB VRAM
    volumes={MODEL_DIR: volume},
    timeout=3600,           # 1 h per request timeout
    allow_concurrent_inputs=4,
    scaledown_window=300,   # keep warm for 5 min after last request
)
class GLMServer:
    @modal.enter()
    def load(self):
        from vllm import LLM

        print("Loading GLM-5 …")
        self.llm = LLM(
            model=MODEL_DIR,
            tensor_parallel_size=8,
            trust_remote_code=True,
            max_model_len=32768,        # trim context for memory — raise if needed
            gpu_memory_utilization=0.92,
            enforce_eager=False,
        )
        print("Model loaded.")

    @modal.method()
    def generate(self, prompt: str, max_tokens: int = 1024, temperature: float = 0.6) -> str:
        from vllm import SamplingParams

        params = SamplingParams(temperature=temperature, max_tokens=max_tokens)
        outputs = self.llm.generate([prompt], params)
        return outputs[0].outputs[0].text

    # OpenAI-compatible  /v1/chat/completions  endpoint
    @modal.web_server(port=8000, startup_timeout=600)
    def openai_server(self):
        import subprocess, sys

        cmd = [
            sys.executable, "-m", "vllm.entrypoints.openai.api_server",
            "--model", MODEL_DIR,
            "--tensor-parallel-size", "8",
            "--trust-remote-code",
            "--max-model-len", "32768",
            "--gpu-memory-utilization", "0.92",
            "--host", "0.0.0.0",
            "--port", "8000",
        ]
        subprocess.Popen(cmd)


# ---------------------------------------------------------------------------
# Quick smoke-test (modal run serve.py)
# ---------------------------------------------------------------------------
@app.local_entrypoint()
def main():
    server = GLMServer()
    reply = server.generate.remote(
        "Hello! Briefly describe what you can do.",
        max_tokens=256,
    )
    print(reply)
