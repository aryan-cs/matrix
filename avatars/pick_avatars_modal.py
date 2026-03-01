import os
import json
import time
import csv
from pathlib import Path

try:
    import pandas as pd
except Exception:  # pragma: no cover - optional dependency
    pd = None
try:
    import requests
except Exception:  # pragma: no cover - optional dependency
    requests = None

# ---------- Inputs ----------
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
AGENTS_CSV = Path(os.environ.get("AGENTS_CSV", ROOT / "backend-test" / "agents.csv"))
AVATAR_CATALOG_JSON = Path(os.environ.get("AVATAR_CATALOG_JSON", HERE / "avatar_catalog.json"))
OUT_MAP_JSON = Path(os.environ.get("OUT_MAP_JSON", HERE / "agent_to_avatar.json"))

# ---------- Modal OpenAI-compatible endpoint ----------
BASE_URL = os.environ.get("PLANNER_BASE_URL", "https://aryan-cs--deepseek-r1-32b-openai-server.modal.run")
CHAT_URL = f"{BASE_URL}/v1/chat/completions"
MODEL_ID = os.environ.get("PLANNER_MODEL_ID", "deepseek-r1")

# If your server enforces auth, set PLANNER_API_KEY; otherwise can be blank.
API_KEY = os.environ.get("PLANNER_API_KEY", "")
CONNECT_TIMEOUT_S = int(os.environ.get("PLANNER_CONNECT_TIMEOUT_S", "15"))
READ_TIMEOUT_S = int(os.environ.get("PLANNER_READ_TIMEOUT_S", "180"))
MAX_RETRIES = int(os.environ.get("PLANNER_MAX_RETRIES", "4"))
RETRY_BACKOFF_S = float(os.environ.get("PLANNER_RETRY_BACKOFF_S", "2.0"))
USE_MODAL_PICKER = os.environ.get("USE_MODAL_PICKER", "0") == "1"

MANUAL_AVATAR_PROFILES = {
    "santa": {"gender": "male", "ethnicities": {"white"}, "age_group": "old"},
    "ann": {"gender": "female", "ethnicities": {"white"}, "age_group": "old"},
    "shawn": {"gender": "male", "ethnicities": {"black"}, "age_group": "young"},
    "dexter": {"gender": "male", "ethnicities": {"white"}, "age_group": "old"},
    "judy": {"gender": "female", "ethnicities": {"black"}, "age_group": "young"},
    "june": {"gender": "female", "ethnicities": {"latinx", "asian"}, "age_group": "young"},
    "silas": {"gender": "male", "ethnicities": {"white"}, "age_group": "young"},
    "bryan": {"gender": "male", "ethnicities": {"white"}, "age_group": "middle"},
    "elenora": {"gender": "female", "ethnicities": {"white"}, "age_group": "middle"},
    "wayne": {"gender": "male", "ethnicities": {"asian"}, "age_group": "middle"},
    "katya": {"gender": "female", "ethnicities": {"white"}, "age_group": "young"},
    "graham": {"gender": "male", "ethnicities": {"white"}, "age_group": "middle"},
    "amina": {"gender": "female", "ethnicities": {"black"}, "age_group": "middle"},
    "anthony": {"gender": "male", "ethnicities": {"black"}, "age_group": "middle"},
    "rika": {"gender": "female", "ethnicities": {"asian"}, "age_group": "middle"},
    "pedro": {"gender": "male", "ethnicities": {"latinx"}, "age_group": "young_middle"},
    "alessandra": {"gender": "female", "ethnicities": {"latinx", "asian"}, "age_group": "young"},
    "anastasia": {"gender": "female", "ethnicities": {"white"}, "age_group": "middle"},
    "thadeus": {"gender": "male", "ethnicities": {"white"}, "age_group": "middle"},
    "marianne": {"gender": "female", "ethnicities": {"latinx"}, "age_group": "middle"},
}

AGE_GROUP_TO_BUCKETS = {
    "young": {"18-24", "25-34"},
    "middle": {"35-44", "45-54"},
    "old": {"55-64", "65+"},
    "young_middle": {"25-34", "35-44", "45-54"},
}

def norm(x):
    return "" if x is None else str(x).strip()

def age_bucket(age_str: str) -> str:
    try:
        a = int(float(age_str))
    except Exception:
        return "unknown"
    if a < 25: return "18-24"
    if a < 35: return "25-34"
    if a < 45: return "35-44"
    if a < 55: return "45-54"
    if a < 65: return "55-64"
    return "65+"

def canon_gender(g: str) -> str:
    g = norm(g).lower()
    if g in ["female", "f", "woman"]: return "female"
    if g in ["male", "m", "man"]: return "male"
    return "unknown"

def canon_ethnicity(e: str) -> str:
    # Coarse on purpose (avoid stereotype-y overfitting)
    e = norm(e).lower()
    if "lat" in e or "hisp" in e: return "latinx"
    if "asian" in e: return "asian"
    if "black" in e or "african" in e: return "black"
    if "white" in e or "cauc" in e: return "white"
    if not e: return "unknown"
    return "other"

def load_catalog():
    catalog = json.loads(Path(AVATAR_CATALOG_JSON).read_text(encoding="utf-8"))
    # keep only active
    catalog = [a for a in catalog if a.get("status") == "ACTIVE" and not a.get("is_expired", False)]
    for avatar in catalog:
        name = norm(avatar.get("name", "")).lower()
        profile = None
        for key, value in MANUAL_AVATAR_PROFILES.items():
            if key in name:
                profile = value
                break
        if profile is None:
            avatar["manual_profile"] = {
                "gender": "unknown",
                "ethnicities": set(),
                "age_group": "unknown",
            }
        else:
            avatar["manual_profile"] = {
                "gender": profile["gender"],
                "ethnicities": set(profile["ethnicities"]),
                "age_group": profile["age_group"],
            }
    return catalog

def summarize_agent(row: dict) -> dict:
    # do NOT include home_address
    return {
        "agent_id": norm(row.get("agent_id")),
        "segment_key": norm(row.get("segment_key")),
        "age_bucket": age_bucket(norm(row.get("age"))),
        "gender": canon_gender(row.get("gender")),
        "ethnicity": canon_ethnicity(row.get("ethnicity")),
        "occupation": norm(row.get("occupation")),
    }

def filter_candidates(agent: dict, catalog: list[dict]) -> list[dict]:
    c = [a for a in catalog if "santa" not in (a.get("name", "").lower())]

    # Gender must match first when possible.
    agent_gender = agent.get("gender", "unknown")
    if agent_gender in {"male", "female"}:
        exact_gender = [a for a in c if (a.get("manual_profile") or {}).get("gender") == agent_gender]
        if exact_gender:
            c = exact_gender

    return c[:80]

def _ethnicity_rank(agent_ethnicity: str, avatar_ethnicities: set[str]) -> int:
    if not avatar_ethnicities:
        return 0
    if agent_ethnicity in avatar_ethnicities:
        return 3
    # closest fallback if exact does not exist
    close_map = {
        "latinx": {"asian", "white"},
        "asian": {"latinx", "white"},
        "white": {"latinx", "asian"},
        "black": {"latinx", "white", "asian"},
    }
    if agent_ethnicity in close_map and avatar_ethnicities.intersection(close_map[agent_ethnicity]):
        return 1
    return -1

def _age_rank(agent_age_bucket: str, avatar_age_group: str) -> int:
    valid = AGE_GROUP_TO_BUCKETS.get(avatar_age_group, set())
    if not valid:
        return 0
    return 2 if agent_age_bucket in valid else -1

def deterministic_pick_avatar(agent: dict, candidates: list[dict]) -> dict:
    if not candidates:
        raise ValueError("No avatar candidates available.")

    occupation = norm(agent.get("occupation", "")).lower()
    occ_terms = [p for p in occupation.replace("/", " ").replace("-", " ").split() if len(p) > 3]

    best = None
    best_key = None
    for c in candidates:
        profile = c.get("manual_profile") or {}
        avatar_ethnicities = profile.get("ethnicities") or set()
        ethnicity_score = _ethnicity_rank(agent.get("ethnicity", "unknown"), avatar_ethnicities)
        age_score = _age_rank(agent.get("age_bucket", "unknown"), profile.get("age_group", "unknown"))

        tags_text = " ".join(c.get("tags", [])).lower()
        role_score = sum(1 for t in occ_terms if t in tags_text)

        # Priority order: ethnicity > age > role tie-breaker > stable name sort
        key = (ethnicity_score, age_score, role_score, c.get("name", ""))
        if best_key is None or key > best_key:
            best_key = key
            best = c

    reason = (
        "Deterministic pick: gender matched first, then ethnicity, then age, "
        "with role-tag tie-breaker."
    )
    confidence = 0.85 if best_key[0] >= 3 else (0.65 if best_key[0] >= 1 else 0.45)
    return {
        "avatar_id": best["id"],
        "confidence": confidence,
        "reason": reason,
    }

def fallback_pick_avatar(agent: dict, candidates: list[dict]) -> dict:
    return deterministic_pick_avatar(agent, candidates)

def modal_chat_json(messages, response_format=None, max_tokens=300):
    if requests is None:
        raise RuntimeError("requests is required when USE_MODAL_PICKER=1.")

    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"

    payload = {
        "model": MODEL_ID,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.0,
    }
    # Some OpenAI-compatible servers ignore response_format. We’ll still send it if provided.
    if response_format is not None:
        payload["response_format"] = response_format

    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.post(
                CHAT_URL,
                headers=headers,
                json=payload,
                timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S),
            )
            r.raise_for_status()
            data = r.json()
            return data["choices"][0]["message"]["content"]
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as err:
            last_err = err
            if attempt >= MAX_RETRIES:
                break
            sleep_s = RETRY_BACKOFF_S * (2 ** (attempt - 1))
            print(
                f"[WARN] Request timeout/connection error (attempt {attempt}/{MAX_RETRIES}). "
                f"Retrying in {sleep_s:.1f}s..."
            )
            time.sleep(sleep_s)
        except requests.exceptions.HTTPError as err:
            last_err = err
            status = err.response.status_code if err.response is not None else None
            retryable = status is not None and status >= 500
            if (not retryable) or attempt >= MAX_RETRIES:
                break
            sleep_s = RETRY_BACKOFF_S * (2 ** (attempt - 1))
            print(
                f"[WARN] HTTP {status} from model endpoint (attempt {attempt}/{MAX_RETRIES}). "
                f"Retrying in {sleep_s:.1f}s..."
            )
            time.sleep(sleep_s)
    raise RuntimeError(f"Model endpoint failed after {MAX_RETRIES} attempts: {last_err}")

def pick_avatar(agent: dict, candidates: list[dict]) -> dict:
    if not USE_MODAL_PICKER:
        return deterministic_pick_avatar(agent, candidates)

    # Keep choices compact: id + name + tags only
    choices = [
        {"id": a["id"], "name": a.get("name",""), "tags": a.get("tags", [])}
        for a in candidates
    ]
    allowed_ids = [c["id"] for c in choices]

    system = (
        "Select one avatar for a fictional agent. "
        "Output MUST be strict JSON only (no prose, no markdown, no prefix/suffix text). "
        "Primary: gender presentation match. Secondary: age vibe. Tertiary: broad ethnicity vibe. "
        "Use role tags only as tie-breakers. Avoid holiday avatars."
    )

    user = {
        "agent": agent,
        "choices": choices,
        "output_rules": {
            "format": "JSON object only",
            "schema": {
                "avatar_id": "string (must be one of allowed_avatar_ids)",
                "confidence": "number from 0 to 1",
                "reason": "short string"
            },
            "no_extra_text": True
        },
        "allowed_avatar_ids": allowed_ids
    }

    # We’ll ask for strict JSON, then parse it.
    raw = modal_chat_json(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user)}
        ],
        response_format={"type": "json_object"},
        max_tokens=180,
    )

    # Robust JSON parse (handles extra text if the model misbehaves)
    raw_stripped = raw.strip()
    start = raw_stripped.find("{")
    end = raw_stripped.rfind("}")
    if start == -1 or end == -1:
        return fallback_pick_avatar(agent, candidates)
    try:
        obj = json.loads(raw_stripped[start:end+1])
    except json.JSONDecodeError:
        return fallback_pick_avatar(agent, candidates)

    avatar_id = obj.get("avatar_id")
    if avatar_id not in allowed_ids:
        return fallback_pick_avatar(agent, candidates)

    return obj


def iter_agent_rows(csv_path: Path) -> list[dict]:
    if pd is not None:
        df = pd.read_csv(csv_path)
        return [r.to_dict() for _, r in df.iterrows()]

    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))

def main():
    print(f"Using agents CSV: {AGENTS_CSV}")
    print(f"Using avatar catalog: {AVATAR_CATALOG_JSON}")
    print(f"Using model endpoint: {CHAT_URL}")
    print(f"Use Modal picker: {USE_MODAL_PICKER}")

    rows = iter_agent_rows(AGENTS_CSV)
    catalog = load_catalog()

    mapping = {}
    if OUT_MAP_JSON.exists():
        mapping = json.loads(OUT_MAP_JSON.read_text(encoding="utf-8"))

    for row in rows:
        agent_id = norm(row.get("agent_id"))
        if not agent_id or agent_id in mapping:
            continue

        agent = summarize_agent(row)
        candidates = filter_candidates(agent, catalog)
        try:
            pick = pick_avatar(agent, candidates)
        except Exception as e:
            print(f"[ERROR] {agent_id}: avatar selection failed: {e}")
            continue

        chosen = next(a for a in catalog if a["id"] == pick["avatar_id"])
        dv = chosen.get("default_voice") or {}

        mapping[agent_id] = {
            "avatar_id": chosen["id"],
            "avatar_name": chosen.get("name"),
            "default_voice_id": dv.get("id"),
            "default_voice_name": dv.get("name"),
            "confidence": float(pick.get("confidence", 0.5)),
            "reason": pick.get("reason", ""),
            "agent_gender": agent["gender"],
            "agent_age_bucket": agent["age_bucket"],
            "agent_ethnicity": agent["ethnicity"],
        }

        OUT_MAP_JSON.write_text(json.dumps(mapping, indent=2), encoding="utf-8")
        print(f"{agent_id} -> {chosen.get('name')} ({mapping[agent_id]['confidence']:.2f})")

    print(f"\nWrote {OUT_MAP_JSON} for {len(mapping)} agents")

if __name__ == "__main__":
    main()
