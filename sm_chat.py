"""
sm_chat.py — Interactive chat with a local LLM (Ollama) + Supermemory

Setup:
  1. Install Ollama: https://ollama.com/download
  2. Pull a model: `ollama pull phi3` (or llama3.2, mistral, etc.)
  3. pip install ollama requests python-dotenv
  4. Run: python sm_chat.py

Memory flow:
  - Before each reply:  search Supermemory for relevant past context
  - After each reply:   store the exchange as a new memory
"""

import os
import sys
import requests
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

OLLAMA_MODEL   = "llama3.2:1b"          # change to any model you have pulled
SM_API_KEY     = os.getenv("SUPERMEMORY_API_KEY")
SM_BASE_URL    = "https://api.supermemory.ai/v3"
SM_SPACE       = "sm-chat-test"  # logical bucket for these memories
TOP_K_MEMORIES = 5               # how many past memories to inject as context

if not SM_API_KEY:
    sys.exit("ERROR: SUPERMEMORY_API_KEY not found. Check your .env file.")

SM_HEADERS = {
    "Authorization": f"Bearer {SM_API_KEY}",
    "Content-Type": "application/json",
}

# ── Supermemory helpers ───────────────────────────────────────────────────────

def sm_add(content: str) -> None:
    """Store a memory in Supermemory."""
    resp = requests.post(
        f"{SM_BASE_URL}/memories",
        headers=SM_HEADERS,
        json={"content": content, "spaces": [SM_SPACE]},
        timeout=10,
    )
    if not resp.ok:
        print(f"[supermemory] write failed: {resp.status_code} {resp.text}")


def sm_search(query: str) -> list[str]:
    """Retrieve relevant memories for a query. Returns list of content strings."""
    resp = requests.post(
        f"{SM_BASE_URL}/search",
        headers=SM_HEADERS,
        json={"q": query, "spaces": [SM_SPACE], "limit": TOP_K_MEMORIES},
        timeout=10,
    )
    if not resp.ok:
        print(f"[supermemory] search failed: {resp.status_code} {resp.text}")
        return []

    data = resp.json()
    # v3: results[].chunks[].content (take the top chunk per result)
    out = []
    for r in data.get("results", []):
        chunks = r.get("chunks", [])
        if chunks and chunks[0].get("content"):
            out.append(chunks[0]["content"])
    return out


# ── Ollama helper ─────────────────────────────────────────────────────────────

def llm_chat(system_prompt: str, history: list[dict]) -> str:
    """Send messages to local Ollama model, return reply text."""
    try:
        import ollama
    except ImportError:
        sys.exit("ERROR: ollama package not found. Run: pip install ollama")

    messages = [{"role": "system", "content": system_prompt}] + history
    resp = ollama.chat(model=OLLAMA_MODEL, messages=messages)
    return resp["message"]["content"].strip()


# ── Main chat loop ────────────────────────────────────────────────────────────

def build_system_prompt(memories: list[str]) -> str:
    base = (
        "You are a helpful assistant with persistent memory. "
        "Use the recalled context below to give consistent, informed answers. "
        "If a memory is irrelevant, ignore it.\n"
    )
    if memories:
        recalled = "\n".join(f"  - {m}" for m in memories)
        base += f"\n[Recalled memories]\n{recalled}\n"
    return base


def main():
    print(f"  Local LLM  : {OLLAMA_MODEL} (via Ollama)")
    print(f"  Memory     : Supermemory / space='{SM_SPACE}'")
    print(f"  Top-K      : {TOP_K_MEMORIES} memories retrieved per turn")
    print("  Type 'quit' or Ctrl-C to exit.\n")
    print("=" * 55)

    history: list[dict] = []   # in-session message history for the LLM

    while True:
        try:
            user_input = input("\nYou: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nExiting.")
            break

        if not user_input:
            continue
        if user_input.lower() in {"quit", "exit", "q"}:
            print("Exiting.")
            break

        # 1. Retrieve relevant memories from Supermemory
        print("[supermemory] searching...", end=" ", flush=True)
        memories = sm_search(user_input)
        print(f"found {len(memories)} memories.")

        # 2. Build system prompt with recalled context
        system = build_system_prompt(memories)

        # 3. Append user turn to in-session history
        history.append({"role": "user", "content": user_input})

        # 4. Call local LLM
        print(f"[{OLLAMA_MODEL}] thinking...", end=" ", flush=True)
        reply = llm_chat(system, history)
        print()

        print(f"\nAssistant: {reply}")

        # 5. Append assistant turn to in-session history
        history.append({"role": "assistant", "content": reply})

        # 6. Store this exchange in Supermemory
        memory_doc = f"User said: {user_input}\nAssistant replied: {reply}"
        sm_add(memory_doc)
        print("[supermemory] memory saved.")


if __name__ == "__main__":
    main()
