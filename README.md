# matrix

simulate anything

## Environment

This project reads endpoints and runtime config from `.env`.

1. Copy `.env.example` to `.env` (already done in this repo).
2. Update values like `VITE_PLANNER_MODEL_ENDPOINT`, `VITE_PLANNER_PROXY_PATH`, `VITE_EXA_PROXY_PATH`, and `EXA_API_ENDPOINT` as needed.

## Hosting DeepSeek 32B on Modal

1. Authenticate Modal:
   - `modal setup`
2. Optional one-time model pre-download:
   - `modal run server.py::download_model`
3. Start endpoint (dev):
   - `modal serve server.py`
4. Deploy persistent endpoint:
   - `modal deploy server.py`
5. Smoke test:
   - `modal run server.py --url "https://<your-endpoint>/v1/chat/completions"`
