#!/usr/bin/env python3
"""
Create LiveAvatar sessions from CSV rows.

Required setup:
  export LIVEAVATAR_API_KEY="..."

Example:
  python avatars/generate_avatars.py \
    --csv data.csv \
    --avatar-id 7b888024-f8c9-4205-95e1-78ce01497bda \
    --voice-id c2527536-6d1f-4412-a643-53a3497dada9 \
    --context-id 13469ff7-5089-4dce-8883-1e15f8879915 \
    --start \
    --out avatars/sessions.jsonl
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

API_BASE = "https://api.liveavatar.com/v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate LiveAvatar sessions from CSV data.")
    parser.add_argument("--csv", default="data.csv", help="Path to CSV input.")
    parser.add_argument("--run-id", default=None, help="Only process rows with this run_id.")
    parser.add_argument("--limit", type=int, default=None, help="Max number of rows to process.")
    parser.add_argument("--avatar-id", required=True, help="Default avatar_id.")
    parser.add_argument("--voice-id", required=True, help="Default voice_id.")
    parser.add_argument("--context-id", required=True, help="Default context_id.")
    parser.add_argument("--language", default="en", help="Default language.")
    parser.add_argument(
        "--start",
        action="store_true",
        help="Start each session after token creation and capture LiveKit credentials.",
    )
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=100,
        help="Delay between rows to avoid spiky request bursts.",
    )
    parser.add_argument(
        "--out",
        default="avatars/sessions.jsonl",
        help="Output JSONL file path.",
    )
    return parser.parse_args()


def request_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {url}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error for {url}: {exc}") from exc

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON response from {url}: {raw[:200]}") from exc


def choose_value(row: dict[str, str], key: str, fallback: str) -> str:
    candidate = (row.get(key) or "").strip()
    return candidate if candidate else fallback


def iter_rows(path: str, run_id: str | None, limit: int | None) -> list[dict[str, str]]:
    with open(path, "r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        return []

    if run_id is not None:
        rows = [r for r in rows if (r.get("run_id") or "").strip() == run_id]
    if limit is not None:
        rows = rows[: max(0, limit)]
    return rows


def create_session_token(
    api_key: str,
    avatar_id: str,
    voice_id: str,
    context_id: str,
    language: str,
) -> dict[str, Any]:
    payload = {
        "avatar_id": avatar_id,
        "mode": "FULL",
        "avatar_persona": {
            "voice_id": voice_id,
            "context_id": context_id,
            "language": language,
        },
    }
    result = request_json(
        "POST",
        f"{API_BASE}/sessions/token",
        headers={
            "X-API-KEY": api_key,
            "accept": "application/json",
            "content-type": "application/json",
        },
        payload=payload,
    )
    return result


def start_session(session_token: str) -> dict[str, Any]:
    result = request_json(
        "POST",
        f"{API_BASE}/sessions/start",
        headers={
            "accept": "application/json",
            "authorization": f"Bearer {session_token}",
        },
    )
    return result


def main() -> int:
    args = parse_args()
    api_key = os.getenv("LIVEAVATAR_API_KEY", "").strip()
    if not api_key:
        print("Missing LIVEAVATAR_API_KEY environment variable.", file=sys.stderr)
        return 1

    rows = iter_rows(args.csv, args.run_id, args.limit)
    if not rows:
        print("No CSV rows matched your filters.", file=sys.stderr)
        return 1

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    successes = 0
    failures = 0
    with out_path.open("w", encoding="utf-8") as out_file:
        for idx, row in enumerate(rows, start=1):
            agent_id = (row.get("agent_id") or f"row_{idx}").strip()

            avatar_id = choose_value(row, "avatar_id", args.avatar_id)
            voice_id = choose_value(row, "voice_id", args.voice_id)
            context_id = choose_value(row, "context_id", args.context_id)
            language = choose_value(row, "language", args.language)

            record: dict[str, Any] = {
                "agent_id": agent_id,
                "run_id": (row.get("run_id") or "").strip(),
                "avatar_id": avatar_id,
                "voice_id": voice_id,
                "context_id": context_id,
                "language": language,
                "status": "pending",
            }

            try:
                token_result = create_session_token(api_key, avatar_id, voice_id, context_id, language)
                token_data = token_result.get("data") or {}
                record["status"] = "token_created"
                record["token_result"] = token_result
                record["session_id"] = token_data.get("session_id")

                if args.start:
                    session_token = token_data.get("session_token")
                    if not session_token:
                        raise RuntimeError("No session_token returned by /sessions/token.")
                    start_result = start_session(session_token)
                    record["status"] = "started"
                    record["start_result"] = start_result

                successes += 1
                print(f"[{idx}/{len(rows)}] OK agent_id={agent_id} status={record['status']}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                record["status"] = "error"
                record["error"] = str(exc)
                print(f"[{idx}/{len(rows)}] ERROR agent_id={agent_id} err={exc}", file=sys.stderr)

            out_file.write(json.dumps(record, ensure_ascii=True) + "\n")
            out_file.flush()

            if args.sleep_ms > 0 and idx < len(rows):
                time.sleep(args.sleep_ms / 1000.0)

    print(
        f"Done. total={len(rows)} success={successes} failure={failures} out={out_path}",
        file=sys.stderr,
    )
    return 0 if failures == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
