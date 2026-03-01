import base64
import csv
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

# ---------- Config ----------
HERE = Path(__file__).resolve().parent
CSV_PATH = Path(os.environ.get("PORTRAITS_CSV_PATH", HERE / "agents.csv"))
OUT_DIR = Path(os.environ.get("PORTRAITS_OUT_DIR", HERE / "out_images"))
OUTPUT_FORMAT = os.environ.get("PORTRAITS_OUTPUT_FORMAT", "webp").strip().lower() or "webp"
SIZE = os.environ.get("PORTRAITS_SIZE", "1024x1024").strip() or "1024x1024"
LIMIT_ENV = os.environ.get("PORTRAITS_LIMIT", "").strip()
LIMIT = int(LIMIT_ENV) if LIMIT_ENV else None
DRY_RUN = os.environ.get("PORTRAITS_DRY_RUN", "0").strip().lower() in {"1", "true", "yes"}
MAX_RETRIES = int(os.environ.get("PORTRAITS_MAX_RETRIES", "3"))
RETRY_BACKOFF_S = float(os.environ.get("PORTRAITS_RETRY_BACKOFF_S", "1.5"))

# Modal/OpenAI-compatible image endpoint.
# Example:
#   PORTRAITS_BASE_URL=https://<your-modal-app>.modal.run
#   PORTRAITS_IMAGE_MODEL=black-forest-labs/FLUX.1-schnell
PORTRAITS_BASE_URL = os.environ.get("PORTRAITS_BASE_URL", "").strip().rstrip("/")
PORTRAITS_IMAGE_ENDPOINT = os.environ.get("PORTRAITS_IMAGE_ENDPOINT", "").strip()
PORTRAITS_IMAGE_MODEL = os.environ.get("PORTRAITS_IMAGE_MODEL", "flux-schnell").strip() or "flux-schnell"
PORTRAITS_API_KEY = os.environ.get("PORTRAITS_API_KEY", "").strip()


def norm(s: Any) -> str:
    return "" if s is None else str(s).strip()


def build_prompt(row: dict[str, str]) -> str:
    # Keep the visual prompt neutral and fictional.
    age = norm(row.get("age", ""))
    gender = norm(row.get("gender", ""))
    ethnicity = norm(row.get("ethnicity", ""))
    occupation = norm(row.get("occupation", ""))
    region = norm(row.get("segment_key", ""))

    return (
        "Photorealistic studio headshot of a fictional person. "
        f"Approximate age: {age}. Gender: {gender}. Ethnicity: {ethnicity}. "
        f"Context: lives in Texas ({region}). Works as: {occupation}. "
        "Head-and-shoulders portrait, centered, neutral light-gray background, "
        "soft even studio lighting, realistic skin texture, DSLR portrait look, "
        "natural hair and modern casual clothing with no logos or text, "
        "friendly calm expression, direct eye contact, no watermark, no text, "
        "must not resemble any real identifiable public figure."
    )


def request_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if PORTRAITS_API_KEY:
        headers["Authorization"] = f"Bearer {PORTRAITS_API_KEY}"

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode("utf-8")
            return json.loads(raw)
        except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt >= MAX_RETRIES:
                break
            time.sleep(RETRY_BACKOFF_S * (2 ** (attempt - 1)))

    raise RuntimeError(f"Request failed after {MAX_RETRIES} attempts: {last_error}")


def image_endpoint() -> str:
    if PORTRAITS_IMAGE_ENDPOINT:
        return PORTRAITS_IMAGE_ENDPOINT
    if PORTRAITS_BASE_URL:
        return f"{PORTRAITS_BASE_URL}/v1/images/generations"
    raise RuntimeError(
        "Set PORTRAITS_BASE_URL or PORTRAITS_IMAGE_ENDPOINT for Modal image generation."
    )


def generate_image_b64(prompt: str) -> str:
    payload = {
        "model": PORTRAITS_IMAGE_MODEL,
        "prompt": prompt,
        "size": SIZE,
        "response_format": "b64_json",
        "output_format": OUTPUT_FORMAT,
    }
    parsed = request_json(image_endpoint(), payload)
    data = parsed.get("data")
    if not isinstance(data, list) or not data:
        raise RuntimeError(f"Unexpected image response shape: {parsed}")
    b64 = data[0].get("b64_json")
    if not isinstance(b64, str) or not b64:
        raise RuntimeError(f"Image response missing b64_json: {parsed}")
    return b64


def iter_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if LIMIT is not None:
        rows = rows[: max(0, LIMIT)]
    return rows


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = iter_rows(CSV_PATH)
    index = []
    errors = 0

    for row in rows:
        agent_id = norm(row.get("agent_id", "unknown"))
        full_name = norm(row.get("full_name", agent_id))
        prompt = build_prompt(row)

        if DRY_RUN:
            print(f"\n--- {agent_id} ({full_name}) ---\n{prompt}\n")
            continue

        try:
            b64 = generate_image_b64(prompt)
            out_path = OUT_DIR / f"{agent_id}.{OUTPUT_FORMAT}"
            out_path.write_bytes(base64.b64decode(b64))
            index.append(
                {
                    "run_id": norm(row.get("run_id", "")),
                    "agent_id": agent_id,
                    "full_name": full_name,
                    "segment_key": norm(row.get("segment_key", "")),
                    "age": norm(row.get("age", "")),
                    "gender": norm(row.get("gender", "")),
                    "ethnicity": norm(row.get("ethnicity", "")),
                    "occupation": norm(row.get("occupation", "")),
                    "image_path": str(out_path),
                }
            )
            print(f"Saved {out_path}")
        except Exception as exc:  # noqa: BLE001
            print(f"[ERROR] {agent_id}: {exc}")
            errors += 1

    (OUT_DIR / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_DIR / 'index.json'}")
    if rows and not index:
        print("No portraits were generated successfully.")
        return 2
    if errors > 0:
        print(f"Portrait generation completed with {errors} error(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
