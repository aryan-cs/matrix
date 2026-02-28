import os
import json
import re
from pathlib import Path

import requests

API_KEY = os.environ["LIVEAVATAR_API_KEY"]
OUT_PATH = Path("avatar_catalog.json")

BASE_URL = "https://api.liveavatar.com/v1/avatars/public"
PAGE_SIZE = 50  # you can set 20, 50, 100 if supported

def infer_tags(name: str) -> list[str]:
    n = name.lower()
    tags = []

    # roles
    role_map = {
        "doctor": ["doctor", "medical"],
        "nurse": ["medical"],
        "therapist": ["therapist"],
        "lawyer": ["lawyer", "legal"],
        "teacher": ["teacher", "education"],
        "hr": ["hr", "corporate"],
        "customer support": ["customer_support", "service"],
        "tech expert": ["tech", "expert"],
        "fitness coach": ["fitness", "coach"],
        "santa": ["holiday"],
    }
    for key, vals in role_map.items():
        if key in n:
            tags.extend(vals)

    # pose / scene
    if "sitting" in n:
        tags.append("sitting")
    if "standing" in n:
        tags.append("standing")
    if "portrait" in n:
        tags.append("portrait")
    if "fireplace" in n:
        tags.append("scene_fireplace")

    # clothing hints (optional)
    if "black suit" in n:
        tags.append("black_suit")
    if "blue suit" in n:
        tags.append("blue_suit")
    if "blue shirt" in n:
        tags.append("blue_shirt")
    if "red suit" in n:
        tags.append("red_suit")
    if "grey" in n or "gray" in n:
        tags.append("grey")

    # de-dupe
    return sorted(set(tags))

def infer_vibe(tags: list[str]) -> str:
    # simple heuristic vibe
    if "holiday" in tags:
        return "seasonal"
    if "lawyer" in tags or "legal" in tags:
        return "formal"
    if "doctor" in tags or "medical" in tags:
        return "authoritative"
    if "therapist" in tags:
        return "calm"
    if "hr" in tags or "corporate" in tags:
        return "corporate"
    if "tech" in tags:
        return "analytical"
    if "fitness" in tags:
        return "energetic"
    if "teacher" in tags:
        return "friendly"
    if "customer_support" in tags:
        return "friendly"
    return "neutral"

def fetch_all():
    url = f"{BASE_URL}?page=1&page_size={PAGE_SIZE}"
    results = []
    while url:
        r = requests.get(url, headers={"X-API-KEY": API_KEY})
        r.raise_for_status()
        payload = r.json()
        data = payload.get("data", {})
        results.extend(data.get("results", []))
        url = data.get("next")
    return results

def main():
    avatars = fetch_all()

    catalog = []
    for a in avatars:
        name = a.get("name", "")
        tags = infer_tags(name)
        vibe = infer_vibe(tags)

        catalog.append({
            "id": a.get("id"),
            "name": name,
            "preview_url": a.get("preview_url"),
            "status": a.get("status"),
            "is_expired": a.get("is_expired"),
            "default_voice": {
                "id": (a.get("default_voice") or {}).get("id"),
                "name": (a.get("default_voice") or {}).get("name"),
            },
            "tags": tags,
            "vibe": vibe,
        })

    # stable sort for diffs
    catalog.sort(key=lambda x: (x["name"] or "", x["id"] or ""))

    OUT_PATH.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_PATH} with {len(catalog)} avatars")

if __name__ == "__main__":
    main()