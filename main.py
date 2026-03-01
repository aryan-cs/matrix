"""Root ASGI entrypoint for platforms that scan the repo root for FastAPI."""

from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from network_builder import app

