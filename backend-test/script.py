"""
DeepSeek-R1-Distill-Qwen-32B on Modal — served via vLLM with an OpenAI-compatible API.

Usage:
  # one-time: download weights into a Modal Volume
  modal run serve.py::download_model

  # deploy the inference server (ephemeral, stops on Ctrl-C)
  modal serve serve.py

  # deploy persistently
  modal deploy serve.py
"""

import modal

APP_NAME = "deepseek-r1-32b"
MODEL_ID = "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B"
MODEL_DIR = "/model"
VOLUME_NAME = "deepseek-r1-32b-weights"
VLLM_PORT = 8000

# ---------------------------------------------------------------------------
# Container image — matches Modal's official vLLM example
# ---------------------------------------------------------------------------
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.8.0-devel-ubuntu22.04", add_python="3.12"
    )
    .entrypoint([])
    .pip_install(
        "vllm==0.8.5",
        "huggingface-hub==0.30.2",
        "hf-transfer>=0.1.8",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

app = modal.App(APP_NAME)
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

# ---------------------------------------------------------------------------
# Step 1: download weights  (run once:  modal run serve.py::download_model)
# ---------------------------------------------------------------------------
@app.function(
    image=image,
    volumes={MODEL_DIR: volume},
    timeout=60 * 60 * 2,
    cpu=8,
    memory=32768,
)
def download_model() -> None:
    """One-time pre-download of model weights into the Modal volume."""
    _download_model_if_needed()


@app.function(
    image=image,
    gpu="A100-80GB:2",
    volumes={MODEL_DIR: volume},
    timeout=60 * 60 * 24,
    scaledown_window=300,
    min_containers=INSTANCE_COUNT,
    max_containers=INSTANCE_COUNT,
)
@modal.concurrent(max_inputs=4)
class DeepSeekServer:
    @modal.enter()
    def start_server(self):
        import subprocess, time, socket

        cmd = [
            "vllm", "serve", MODEL_DIR,
            "--served-model-name", "deepseek-r1",
            "--tensor-parallel-size", "2",
            "--host", "0.0.0.0",
            "--port", str(VLLM_PORT),
            "--max-model-len", "32768",
            "--gpu-memory-utilization", "0.92",
            "--enforce-eager",
            "--trust-remote-code",
        ]
        self._proc = subprocess.Popen(cmd)

        # wait for server to be ready (model loading can take ~5 min)
        for _ in range(600):
            try:
                s = socket.create_connection(("127.0.0.1", VLLM_PORT), timeout=1)
                s.close()
                print("vLLM server is ready.")
                return
            except OSError:
                time.sleep(1)
        raise RuntimeError("vLLM server did not start in time.")

    @modal.exit()
    def stop_server(self):
        self._proc.terminate()

    @modal.web_server(port=VLLM_PORT, startup_timeout=600)
    def openai_server(self):
        pass  # server is already running from start_server()


# ---------------------------------------------------------------------------
# Quick smoke-test  (modal run serve.py)
# ---------------------------------------------------------------------------
@app.local_entrypoint()
def main():
    import urllib.request, json
    url = "https://jajooananya--deepseek-r1-32b-deepseekserver-openai-server-dev.modal.run/v1/chat/completions"
    body = json.dumps({
        "model": "deepseek-r1",
        "messages": [{"role": "user", "content": "Hello! What can you do?"}],
        "max_tokens": 200,
    }).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        print(json.loads(resp.read())["choices"][0]["message"]["content"])