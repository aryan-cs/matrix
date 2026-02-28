#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_APP="${BACKEND_APP:-network_builder:app}"

BACKEND_PID=""
FRONTEND_PID=""

log() {
  printf "[start] %s\n" "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "[start] Error: required command '%s' is not installed.\n" "$1" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    log "Stopping backend (pid $BACKEND_PID)"
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    log "Stopping frontend (pid $FRONTEND_PID)"
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if [[ ! -d "$FRONTEND_DIR" ]]; then
  printf "[start] Error: frontend directory not found at %s\n" "$FRONTEND_DIR" >&2
  exit 1
fi

require_cmd npm

if [[ -d "$BACKEND_DIR" ]]; then
  require_cmd uv
  log "Bootstrapping backend with uv..."
  pushd "$BACKEND_DIR" >/dev/null
  uv venv
  uv sync
  popd >/dev/null
else
  log "No backend directory found, skipping backend setup."
fi

log "Bootstrapping frontend..."
pushd "$FRONTEND_DIR" >/dev/null
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
popd >/dev/null

if [[ -d "$BACKEND_DIR" ]]; then
  log "Starting backend on http://$BACKEND_HOST:$BACKEND_PORT"
  (
    cd "$BACKEND_DIR"
    uv run uvicorn "$BACKEND_APP" --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT"
  ) &
  BACKEND_PID="$!"
fi

log "Starting frontend on http://$FRONTEND_HOST:$FRONTEND_PORT"
(
  cd "$FRONTEND_DIR"
  npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
) &
FRONTEND_PID="$!"

if [[ -n "$BACKEND_PID" ]]; then
  log "Backend PID: $BACKEND_PID"
fi
log "Frontend PID: $FRONTEND_PID"
log "Press Ctrl+C to stop all services."

wait
