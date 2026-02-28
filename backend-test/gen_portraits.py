import os
import json
import base64
from pathlib import Path

import pandas as pd
from openai import OpenAI

# ---------- Config ----------
CSV_PATH = "agents.csv"
OUT_DIR = Path("out_images")
MODEL = "gpt-image-1"
SIZE = "1024x1024"
OUTPUT_FORMAT = "webp"

# Start with a small test, then set to None for all
LIMIT = 5       # set None for all rows
DRY_RUN = False # True prints prompts only

client = OpenAI()
OUT_DIR.mkdir(parents=True, exist_ok=True)

def norm(s):
    return "" if s is None else str(s).strip()

def build_prompt(row: dict) -> str:
    # IMPORTANT: We intentionally ignore home_address and full_name in the visual description
    age = norm(row.get("age", ""))
    gender = norm(row.get("gender", ""))
    ethnicity = norm(row.get("ethnicity", ""))
    occupation = norm(row.get("occupation", ""))
    region = norm(row.get("segment_key", ""))  # or you can map this to a broader region label

    # Keep visuals neutral to avoid stereotype pitfalls.
    # Use occupation only as a subtle vibe (not uniforms, not logos).
    prompt = f"""
Photorealistic studio headshot of a fictional person.
Approximate age: {age}. Gender: {gender}. Ethnicity: {ethnicity}.
Context: lives in Texas ({region}). Works as: {occupation}.

Style requirements:
- Head-and-shoulders portrait, centered, neutral light-gray background
- Soft even studio lighting, realistic skin texture, DSLR look (85mm portrait lens feel)
- Natural hair and modern casual clothing with no logos or text
- Friendly, calm expression, direct eye contact
- No watermark, no text, no badges, no uniforms, no brand marks

Safety:
- Must not resemble any real identifiable person or public figure; make them clearly fictional.
""".strip()
    return prompt

def save_b64_image(b64_data: str, path: Path):
    path.write_bytes(base64.b64decode(b64_data))

def main():
    df = pd.read_csv(CSV_PATH)

    if LIMIT is not None:
        df = df.head(LIMIT)

    index = []

    for _, r in df.iterrows():
        row = r.to_dict()
        agent_id = norm(row.get("agent_id", "unknown"))
        full_name = norm(row.get("full_name", agent_id))

        prompt = build_prompt(row)

        if DRY_RUN:
            print(f"\n--- {agent_id} ({full_name}) ---\n{prompt}\n")
            continue

        try:
            res = client.images.generate(
                model=MODEL,
                prompt=prompt,
                size=SIZE,
                output_format=OUTPUT_FORMAT,
            )

            b64 = res.data[0].b64_json
            out_path = OUT_DIR / f"{agent_id}.{OUTPUT_FORMAT}"
            save_b64_image(b64, out_path)

            index.append({
                "run_id": norm(row.get("run_id", "")),
                "agent_id": agent_id,
                "full_name": full_name,
                "segment_key": norm(row.get("segment_key", "")),
                "age": norm(row.get("age", "")),
                "gender": norm(row.get("gender", "")),
                "ethnicity": norm(row.get("ethnicity", "")),
                "occupation": norm(row.get("occupation", "")),
                "image_path": str(out_path),
            })

            print(f"Saved {out_path}")

        except Exception as e:
            print(f"[ERROR] {agent_id}: {e}")

    (OUT_DIR / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_DIR / 'index.json'}")

if __name__ == "__main__":
    main()