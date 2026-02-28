"""
DeepSeek-R1-Distill-Qwen-1.5B on Modal — served via vLLM with an OpenAI-compatible API.

Usage:
  # one-time: download weights into a Modal Volume
  modal run server.py::download_model

  # deploy the inference server (ephemeral, stops on Ctrl-C)
  modal serve server.py

  # deploy persistently
  modal deploy server.py
"""

import modal

APP_NAME = "deepseek-r1-1p5b"
MODEL_ID = "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"
MODEL_DIR = "/model"
VOLUME_NAME = "deepseek-r1-1p5b-weights"
VLLM_PORT = 8000
INSTANCE_COUNT = 10
TARGET_TOTAL_CONCURRENCY = 100
MAX_INPUTS_PER_INSTANCE = (TARGET_TOTAL_CONCURRENCY + INSTANCE_COUNT - 1) // INSTANCE_COUNT

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

# Persistent volume — weights survive across runs so you only download once.
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

# ---------------------------------------------------------------------------
# Step 1: download weights  (run once:  modal run server.py::download_model)
# ---------------------------------------------------------------------------
@app.function(
    image=image,
    volumes={MODEL_DIR: volume},
    timeout=7200,
    cpu=8,
    memory=32768,
)
def download_model():
    from huggingface_hub import snapshot_download
    snapshot_download(MODEL_ID, local_dir=MODEL_DIR)
    volume.commit()
    print("Done.")


# ---------------------------------------------------------------------------
# Step 2: serve
# ---------------------------------------------------------------------------
@app.cls(
    image=image,
    gpu="A100-80GB:1",
    volumes={MODEL_DIR: volume},
    timeout=3600,
    scaledown_window=300,
    min_containers=INSTANCE_COUNT,
    max_containers=INSTANCE_COUNT,
)
@modal.concurrent(max_inputs=MAX_INPUTS_PER_INSTANCE)
class DeepSeekServer:
    @modal.enter()
    def start_server(self):
        import subprocess, time, socket

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
# Quick smoke-test  (modal run server.py)
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
