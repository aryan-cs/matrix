from __future__ import annotations

from pathlib import Path
import os

try:
    from dotenv import load_dotenv as _load_dotenv
except ImportError:
    _load_dotenv = None


def _load_repo_env_file() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if _load_dotenv is not None:
        _load_dotenv(env_path)
        return
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


_load_repo_env_file()

import asyncio
import csv
import io
import json
import re
import urllib.parse
import urllib.error
import urllib.request
from typing import Any, Optional

import httpx
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field


REQUIRED_COLUMNS = {"agent_id", "connections", "system_prompt"}
CONNECTION_SPLIT_PATTERN = re.compile(r"[|;,]")
TEXT_MIME_PREFIX = "text/"
TEXT_EXTENSIONS = {
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".tsv",
    ".json",
    ".yaml",
    ".yml",
    ".xml",
    ".html",
    ".htm",
    ".log",
}
DEFAULT_PLANNER_ENDPOINT = (
    "https://aryan-cs--deepseek-r1-32b-openai-server.modal.run/v1/chat/completions"
)
DEFAULT_PLANNER_MODEL_ID = "deepseek-r1"
PLANNER_CONTEXT_MAX_TOTAL_CHARS = 26000
PLANNER_CONTEXT_MAX_FILE_CHARS = 5000
DEFAULT_LIVEAVATAR_BASE_URL = "https://api.liveavatar.com/v1"
DEFAULT_AGENTS_CSV_PATH = Path(__file__).resolve().parent.parent / "backend-test" / "agents.csv"
DEFAULT_AGENT_TO_AVATAR_PATH = (
    Path(__file__).resolve().parent.parent / "avatars" / "agent_to_avatar.json"
)


class GraphBuildRequest(BaseModel):
    csv_text: str = Field(..., min_length=1)
    directed: bool = False


class GraphNode(BaseModel):
    id: str
    metadata: dict[str, str]
    connections: list[str]
    declared_connections: list[str]


class GraphEdge(BaseModel):
    source: str
    target: str


class GraphStats(BaseModel):
    node_count: int
    edge_count: int
    isolated_node_count: int
    unresolved_connection_count: int
    connected_component_count: int


class GraphBuildResponse(BaseModel):
    directed: bool
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    stats: GraphStats
    warnings: list[str]


class PlannerContextResponse(BaseModel):
    output_text: str
    model: str


class AvatarAgentSummary(BaseModel):
    agent_id: str
    full_name: str
    segment_key: str
    avatar_id: str
    avatar_name: str
    default_voice_id: str
    default_voice_name: str


class AvatarAgentsResponse(BaseModel):
    agents: list[AvatarAgentSummary]


class AvatarSessionStartRequest(BaseModel):
    agent_id: str = Field(..., min_length=1)


class AvatarSessionStartResponse(BaseModel):
    agent_id: str
    avatar_id: str
    avatar_name: str
    default_voice_id: str
    default_voice_name: str
    livekit_url: str
    livekit_client_token: str
    session_id: str
    system_prompt: str


app = FastAPI(
    title="Matrix Backend API",
    version="0.1.0",
    description="CSV-to-social-graph construction APIs for representative agent simulations.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_planner_system_prompt() -> str:
    default_prompt = (
        "You are a simulation planner assistant. "
        "Use provided prompt + context files to generate representative-agent master CSV output."
    )
    prompt_path = Path(__file__).resolve().parent.parent / "planner-system-prompt.txt"
    try:
        raw = prompt_path.read_text(encoding="utf-8").strip()
        return raw or default_prompt
    except OSError:
        return default_prompt


def _planner_endpoint() -> str:
    return os.getenv("PLANNER_MODEL_ENDPOINT", DEFAULT_PLANNER_ENDPOINT).strip()


def _planner_model_id() -> str:
    return os.getenv("PLANNER_MODEL_ID", DEFAULT_PLANNER_MODEL_ID).strip()


def _planner_api_key() -> str:
    return os.getenv("PLANNER_API_KEY", "").strip()


def _planner_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    api_key = _planner_api_key()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _planner_payload(prompt: str, context_block: str, *, stream: bool) -> dict[str, Any]:
    model_id = _planner_model_id()
    return {
        "model": model_id,
        "temperature": 0.2,
        "stream": stream,
        "messages": [
            {"role": "system", "content": _load_planner_system_prompt()},
            {
                "role": "user",
                "content": f"Simulation request:\n{prompt}\n\nAttached context:\n{context_block}",
            },
        ],
    }


def _normalize_record(record: dict[str, Any], fieldnames: list[str]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for field in fieldnames:
        raw_value = record.get(field, "")
        normalized[field] = str(raw_value).strip() if raw_value is not None else ""
    return normalized


def _is_repeated_header_row(row: dict[str, str], fieldnames: list[str]) -> bool:
    for name in fieldnames:
        if row.get(name, "").strip().lower() != name.strip().lower():
            return False
    return True


def _parse_connections(raw_connections: str) -> list[str]:
    raw = (raw_connections or "").strip()
    if not raw:
        return []

    seen: set[str] = set()
    parsed: list[str] = []
    for item in CONNECTION_SPLIT_PATTERN.split(raw):
        candidate = item.strip()
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        parsed.append(candidate)
    return parsed


def _is_text_context_file(file: UploadFile) -> bool:
    content_type = (file.content_type or "").lower()
    if content_type.startswith(TEXT_MIME_PREFIX):
        return True
    suffix = Path(file.filename or "").suffix.lower()
    return suffix in TEXT_EXTENSIONS


async def _build_context_block(files: list[UploadFile]) -> str:
    if not files:
        return "No external context files attached."

    remaining_chars = PLANNER_CONTEXT_MAX_TOTAL_CHARS
    sections: list[str] = []
    for upload in files:
        descriptor = f"{upload.filename or 'unknown-file'} ({upload.content_type or 'application/octet-stream'})"
        if not _is_text_context_file(upload):
            sections.append(
                f"File: {descriptor}\nContent: [Binary or non-text file attached; not inlined.]"
            )
            continue

        if remaining_chars <= 0:
            sections.append(f"File: {descriptor}\nContent: [Omitted due to context size budget.]")
            continue

        raw = await upload.read()
        try:
            decoded = raw.decode("utf-8")
        except UnicodeDecodeError:
            decoded = raw.decode("utf-8", errors="ignore")

        excerpt_limit = min(PLANNER_CONTEXT_MAX_FILE_CHARS, remaining_chars)
        excerpt = decoded[:excerpt_limit]
        remaining_chars -= len(excerpt)
        suffix = "\n...[truncated]" if len(decoded) > len(excerpt) else ""
        sections.append(f"File: {descriptor}\nContent:\n```\n{excerpt}{suffix}\n```")

    return "\n\n".join(sections)


def _call_planner_model(prompt: str, context_block: str) -> tuple[str, str]:
    planner_endpoint = _planner_endpoint()
    if not planner_endpoint:
        raise ValueError("Planner endpoint is not configured.")

    model_id = _planner_model_id()
    payload = _planner_payload(prompt, context_block, stream=False)

    request = urllib.request.Request(
        planner_endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers=_planner_headers(),
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise ValueError(f"Planner endpoint responded {exc.code}: {detail[:220]}") from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"Planner endpoint request failed: {exc.reason}") from exc

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("Planner response was not valid JSON.") from exc

    content = parsed.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("Planner returned empty content.")
    return content, model_id


def _planner_stream_events(prompt: str, context_block: str):
    planner_endpoint = _planner_endpoint()
    if not planner_endpoint:
        raise ValueError("Planner endpoint is not configured.")

    payload = _planner_payload(prompt, context_block, stream=True)
    request = urllib.request.Request(
        planner_endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers=_planner_headers(),
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=240) as response:
        buffered_content = ""
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line:
                continue

            if not line.startswith("data:"):
                # Some providers may emit plain JSON even with stream=true.
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    continue
                chunk = parsed.get("choices", [{}])[0].get("message", {}).get("content", "")
                if isinstance(chunk, str) and chunk:
                    buffered_content += chunk
                    yield f"data: {json.dumps({'delta': chunk})}\n\n"
                continue

            data = line[len("data:") :].strip()
            if not data:
                continue
            if data == "[DONE]":
                yield "data: [DONE]\n\n"
                return

            try:
                parsed = json.loads(data)
            except json.JSONDecodeError:
                continue

            if parsed.get("error"):
                yield f"data: {json.dumps({'error': parsed['error']})}\n\n"
                yield "data: [DONE]\n\n"
                return

            delta = (
                parsed.get("choices", [{}])[0].get("delta", {}).get("content", "")
                or parsed.get("choices", [{}])[0].get("message", {}).get("content", "")
                or ""
            )
            if not isinstance(delta, str) or not delta:
                continue

            buffered_content += delta
            yield f"data: {json.dumps({'delta': delta})}\n\n"

        if buffered_content:
            yield "data: [DONE]\n\n"


def _agents_csv_path() -> Path:
    configured = os.getenv("AVATAR_AGENTS_CSV", str(DEFAULT_AGENTS_CSV_PATH)).strip()
    return Path(configured)


def _agent_mapping_path() -> Path:
    configured = os.getenv("AGENT_TO_AVATAR_JSON", str(DEFAULT_AGENT_TO_AVATAR_PATH)).strip()
    return Path(configured)


def _liveavatar_base_url() -> str:
    return os.getenv("LIVEAVATAR_BASE_URL", DEFAULT_LIVEAVATAR_BASE_URL).strip().rstrip("/")


def _liveavatar_api_key() -> str:
    return os.getenv("LIVEAVATAR_API_KEY", "").strip()


def _liveavatar_context_id() -> str:
    return os.getenv("LIVEAVATAR_CONTEXT_ID", "").strip()


def _load_agents_by_id() -> dict[str, dict[str, str]]:
    agents_path = _agents_csv_path()
    if not agents_path.exists():
        raise ValueError(f"Agents CSV not found: {agents_path}")

    with agents_path.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    by_id: dict[str, dict[str, str]] = {}
    for row in rows:
        agent_id = str(row.get("agent_id", "")).strip()
        if not agent_id:
            continue
        by_id[agent_id] = {k: (str(v).strip() if v is not None else "") for k, v in row.items()}
    return by_id


def _load_agent_avatar_mapping() -> dict[str, dict[str, Any]]:
    mapping_path = _agent_mapping_path()
    if not mapping_path.exists():
        raise ValueError(f"Agent/avatar mapping file not found: {mapping_path}")
    try:
        parsed = json.loads(mapping_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Agent/avatar mapping JSON is invalid: {mapping_path}") from exc

    if not isinstance(parsed, dict):
        raise ValueError("Agent/avatar mapping JSON must be an object keyed by agent_id.")
    return parsed


def _liveavatar_request(
    method: str,
    path: str,
    *,
    payload: Optional[dict[str, Any]] = None,
    session_token: Optional[str] = None,
) -> dict[str, Any]:
    base_url = _liveavatar_base_url()
    api_key = _liveavatar_api_key()
    if not base_url:
        raise ValueError("LIVEAVATAR_BASE_URL is not configured.")
    if not api_key:
        raise ValueError("LIVEAVATAR_API_KEY is not configured.")

    url = urllib.parse.urljoin(f"{base_url}/", path.lstrip("/"))
    headers = {"accept": "application/json"}
    body = None
    if payload is not None:
        headers["content-type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")

    if session_token:
        headers["authorization"] = f"Bearer {session_token}"
    else:
        headers["X-API-KEY"] = api_key

    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise ValueError(f"LiveAvatar API error {exc.code}: {detail[:260]}") from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"LiveAvatar API request failed: {exc.reason}") from exc

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("LiveAvatar API returned invalid JSON.") from exc

    if parsed.get("code") != 1000:
        raise ValueError(
            f"LiveAvatar API returned code={parsed.get('code')}: {parsed.get('message', 'unknown error')}"
        )
    return parsed


def _parse_csv_rows(csv_text: str) -> tuple[list[str], list[dict[str, str]]]:
    with io.StringIO(csv_text) as handle:
        reader = csv.DictReader(handle)
        fieldnames = [name.strip() for name in (reader.fieldnames or []) if name and name.strip()]
        if not fieldnames:
            raise ValueError("CSV is missing a header row.")

        missing_columns = [name for name in REQUIRED_COLUMNS if name not in fieldnames]
        if missing_columns:
            raise ValueError(
                f"CSV is missing required column(s): {', '.join(sorted(missing_columns))}."
            )

        rows: list[dict[str, str]] = []
        for line_index, record in enumerate(reader, start=2):
            normalized = _normalize_record(record, fieldnames)
            if not any(value for value in normalized.values()):
                continue
            if _is_repeated_header_row(normalized, fieldnames):
                continue

            agent_id = normalized.get("agent_id", "")
            if not agent_id:
                raise ValueError(f"Row {line_index} is missing agent_id.")
            rows.append(normalized)

    if not rows:
        raise ValueError("CSV has no data rows.")

    return fieldnames, rows


def build_social_graph(csv_text: str, directed: bool = False) -> GraphBuildResponse:
    _fieldnames, rows = _parse_csv_rows(csv_text)

    rows_by_agent_id: dict[str, dict[str, str]] = {}
    ordered_agent_ids: list[str] = []
    duplicate_ids: list[str] = []
    warnings: list[str] = []

    for row in rows:
        agent_id = row["agent_id"]
        if agent_id in rows_by_agent_id:
            duplicate_ids.append(agent_id)
            continue
        rows_by_agent_id[agent_id] = row
        ordered_agent_ids.append(agent_id)

    if duplicate_ids:
        duplicates_display = ", ".join(sorted(set(duplicate_ids)))
        raise ValueError(f"Duplicate agent_id values detected: {duplicates_display}.")

    adjacency: dict[str, set[str]] = {agent_id: set() for agent_id in ordered_agent_ids}
    declared_connections_map: dict[str, list[str]] = {}
    edge_set: set[tuple[str, str]] = set()
    unresolved_count = 0

    for source_agent_id in ordered_agent_ids:
        row = rows_by_agent_id[source_agent_id]
        declared_connections = _parse_connections(row.get("connections", ""))
        declared_connections_map[source_agent_id] = declared_connections

        for target_agent_id in declared_connections:
            if target_agent_id == source_agent_id:
                warnings.append(f"Self-connection ignored for agent_id '{source_agent_id}'.")
                continue

            if target_agent_id not in rows_by_agent_id:
                unresolved_count += 1
                warnings.append(
                    "Unresolved connection ignored: "
                    f"'{source_agent_id}' -> '{target_agent_id}'."
                )
                continue

            if directed:
                edge_key = (source_agent_id, target_agent_id)
                if edge_key in edge_set:
                    continue
                edge_set.add(edge_key)
                adjacency[source_agent_id].add(target_agent_id)
            else:
                left, right = sorted((source_agent_id, target_agent_id))
                edge_key = (left, right)
                if edge_key in edge_set:
                    continue
                edge_set.add(edge_key)
                adjacency[source_agent_id].add(target_agent_id)
                adjacency[target_agent_id].add(source_agent_id)

    edge_list: list[GraphEdge] = [
        GraphEdge(source=source, target=target) for source, target in sorted(edge_set)
    ]

    undirected_view: dict[str, set[str]] = {agent_id: set() for agent_id in ordered_agent_ids}
    for source, target in edge_set:
        undirected_view[source].add(target)
        undirected_view[target].add(source)

    connected_components = 0
    visited: set[str] = set()
    for agent_id in ordered_agent_ids:
        if agent_id in visited:
            continue
        connected_components += 1
        stack = [agent_id]
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            stack.extend(neighbor for neighbor in undirected_view[current] if neighbor not in visited)

    if connected_components > 1:
        warnings.append(
            f"Graph is disconnected: found {connected_components} connected components."
        )

    node_list: list[GraphNode] = []
    isolated_count = 0
    for agent_id in ordered_agent_ids:
        connections = sorted(adjacency[agent_id])
        if not connections:
            isolated_count += 1
        node_list.append(
            GraphNode(
                id=agent_id,
                metadata=rows_by_agent_id[agent_id],
                connections=connections,
                declared_connections=declared_connections_map.get(agent_id, []),
            )
        )

    stats = GraphStats(
        node_count=len(node_list),
        edge_count=len(edge_list),
        isolated_node_count=isolated_count,
        unresolved_connection_count=unresolved_count,
        connected_component_count=connected_components,
    )

    return GraphBuildResponse(
        directed=directed,
        nodes=node_list,
        edges=edge_list,
        stats=stats,
        warnings=warnings,
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/graph/from-csv-text", response_model=GraphBuildResponse)
async def graph_from_csv_text(payload: GraphBuildRequest) -> GraphBuildResponse:
    try:
        return build_social_graph(payload.csv_text, directed=payload.directed)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/graph/from-csv-file", response_model=GraphBuildResponse)
async def graph_from_csv_file(
    file: UploadFile = File(...),
    directed: bool = False,
) -> GraphBuildResponse:
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a .csv file.")

    try:
        content = await file.read()
        csv_text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="CSV file must be UTF-8 encoded.") from exc

    try:
        return build_social_graph(csv_text, directed=directed)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/planner/context", response_model=PlannerContextResponse)
async def planner_context(
    prompt: str = Form(...),
    context_manifest: str = Form(default=""),
    context_files: list[UploadFile] = File(default=[]),
) -> PlannerContextResponse:
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required.")

    _ = context_manifest  # reserved for audit/debug use; included by frontend form payload

    try:
        context_block = await _build_context_block(context_files)
        output_text, model_id = _call_planner_model(prompt.strip(), context_block)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive guard
        raise HTTPException(
            status_code=502,
            detail=f"Planner pipeline failed unexpectedly: {type(exc).__name__}: {exc}",
        ) from exc

    return PlannerContextResponse(output_text=output_text, model=model_id)


@app.post("/api/planner/context/stream")
async def planner_context_stream(
    prompt: str = Form(...),
    context_manifest: str = Form(default=""),
    context_files: list[UploadFile] = File(default=[]),
):
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required.")

    _ = context_manifest  # reserved for audit/debug use; included by frontend form payload
    context_block = await _build_context_block(context_files)

    def event_generator():
        done_emitted = False
        try:
            for event in _planner_stream_events(prompt.strip(), context_block):
                if event.strip() == "data: [DONE]":
                    done_emitted = True
                yield event
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            yield f"data: {json.dumps({'error': f'Planner endpoint responded {exc.code}: {detail[:220]}'})}\n\n"
        except urllib.error.URLError as exc:
            yield f"data: {json.dumps({'error': f'Planner endpoint request failed: {exc.reason}'})}\n\n"
        except Exception as exc:  # pragma: no cover - defensive guard
            yield f"data: {json.dumps({'error': f'Planner stream failed: {type(exc).__name__}: {exc}'})}\n\n"
        finally:
            if not done_emitted:
                yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
@app.get("/api/avatar/agents", response_model=AvatarAgentsResponse)
async def avatar_agents() -> AvatarAgentsResponse:
    try:
        agents_by_id = _load_agents_by_id()
        mapping = _load_agent_avatar_mapping()
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    result: list[AvatarAgentSummary] = []
    for agent_id, agent in sorted(agents_by_id.items()):
        mapped = mapping.get(agent_id)
        if not isinstance(mapped, dict):
            continue
        result.append(
            AvatarAgentSummary(
                agent_id=agent_id,
                full_name=agent.get("full_name", ""),
                segment_key=agent.get("segment_key", ""),
                avatar_id=str(mapped.get("avatar_id", "")).strip(),
                avatar_name=str(mapped.get("avatar_name", "")).strip(),
                default_voice_id=str(mapped.get("default_voice_id", "")).strip(),
                default_voice_name=str(mapped.get("default_voice_name", "")).strip(),
            )
        )
    return AvatarAgentsResponse(agents=result)


@app.post("/api/avatar/session/start", response_model=AvatarSessionStartResponse)
async def avatar_session_start(payload: AvatarSessionStartRequest) -> AvatarSessionStartResponse:
    agent_id = payload.agent_id.strip()
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id is required.")

    context_id = _liveavatar_context_id()
    if not context_id:
        raise HTTPException(status_code=500, detail="LIVEAVATAR_CONTEXT_ID is not configured.")

    try:
        agents_by_id = _load_agents_by_id()
        mapping = _load_agent_avatar_mapping()
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    agent = agents_by_id.get(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Unknown agent_id: {agent_id}")

    mapped = mapping.get(agent_id)
    if not isinstance(mapped, dict):
        raise HTTPException(status_code=404, detail=f"No avatar mapping found for agent_id: {agent_id}")

    avatar_id = str(mapped.get("avatar_id", "")).strip()
    voice_id = str(mapped.get("default_voice_id", "")).strip()
    if not avatar_id:
        raise HTTPException(status_code=400, detail=f"Missing avatar_id for agent_id: {agent_id}")
    if not voice_id:
        raise HTTPException(status_code=400, detail=f"Missing default_voice_id for agent_id: {agent_id}")

    try:
        token_payload = {
            "avatar_id": avatar_id,
            "mode": "FULL",
            "avatar_persona": {
                "voice_id": voice_id,
                "context_id": context_id,
                "language": "en",
            },
        }
        token_result = _liveavatar_request("POST", "/sessions/token", payload=token_payload)
        session_token = (
            token_result.get("data", {}).get("session_token", "") if isinstance(token_result, dict) else ""
        )
        if not session_token:
            raise ValueError("LiveAvatar token response did not include session_token.")
        start_result = _liveavatar_request("POST", "/sessions/start", session_token=session_token)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    start_data = start_result.get("data", {}) if isinstance(start_result, dict) else {}
    livekit_url = str(start_data.get("livekit_url", "")).strip()
    livekit_client_token = str(start_data.get("livekit_client_token", "")).strip()
    session_id = str(start_data.get("session_id", "")).strip()
    if not livekit_url or not livekit_client_token or not session_id:
        raise HTTPException(status_code=502, detail="LiveAvatar start response missing LiveKit credentials.")

    return AvatarSessionStartResponse(
        agent_id=agent_id,
        avatar_id=avatar_id,
        avatar_name=str(mapped.get("avatar_name", "")).strip(),
        default_voice_id=voice_id,
        default_voice_name=str(mapped.get("default_voice_name", "")).strip(),
        livekit_url=livekit_url,
        livekit_client_token=livekit_client_token,
        session_id=session_id,
        system_prompt=agent.get("system_prompt", ""),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Simulation — 5-day agent communication with Supermemory persistence
# ──────────────────────────────────────────────────────────────────────────────

SUPERMEMORY_API_KEY = os.getenv("SUPERMEMORY_API_KEY", "").strip()
SUPERMEMORY_BASE_URL = "https://api.supermemory.ai"
SIMULATION_GRAPH_PATH = Path(__file__).resolve().parent / "graph.json"
SIMULATION_DAYS = 5
SIMULATION_NEWS_SPARK = (
    "BREAKING: A leaked Texas legislative proposal suggests a 20% tax credit "
    "for small businesses, offset by a 5% tax hike on luxury properties over $2M."
)
SIMULATION_MODAL_ENDPOINT = os.getenv(
    "SIM_MODAL_ENDPOINT",
    "https://matrix--deepseek-r1-1p5b-deepseekserver-openai-server.modal.run",
).strip().rstrip("/") + "/v1/chat/completions"

_sim_status: dict = {"state": "idle", "progress": 0, "total": 0, "day": 0, "error": ""}
_sim_results: dict = {}


async def _store_supermemory(agent_id: str, day: int, content: str) -> None:
    """Persist an agent's daily thought to Supermemory."""
    if not SUPERMEMORY_API_KEY:
        return
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            await client.post(
                f"{SUPERMEMORY_BASE_URL}/v1/memories",
                headers={
                    "Authorization": f"Bearer {SUPERMEMORY_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "content": f"[Agent {agent_id} | Day {day}]\n{content}",
                    "metadata": {"agent_id": agent_id, "day": str(day)},
                },
            )
    except Exception:
        pass


async def _call_sim_agent(
    agent_id: str,
    system_prompt: str,
    full_name: str,
    incoming_messages: list[str],
    neighbor_names: list[str],
) -> str:
    """Call DeepSeek R1 on Modal for one agent turn."""
    first_name = full_name.split()[0] if full_name else agent_id

    if not neighbor_names:
        user_content = f'You just heard this news: "{incoming_messages[0]}"'
    elif len(incoming_messages) == 1:
        user_content = f'Your neighbor {neighbor_names[0]} just shared: "{incoming_messages[0]}"'
    else:
        msgs = "\n".join(
            f'- {neighbor_names[i] if i < len(neighbor_names) else "Someone"} said: "{m[:200]}"'
            for i, m in enumerate(incoming_messages[:5])
        )
        user_content = f"Your neighbors have been talking:\n{msgs}\nWhat's your take?"

    payload = {
        "model": "deepseek-r1",
        "messages": [
            {
                "role": "system",
                "content": (
                    f"You ARE {full_name}. {system_prompt}\n\n"
                    f"IMPORTANT: You are {full_name}. Speak in first person ('I', 'me', 'my'). "
                    f"Never use any other name for yourself. Never narrate. "
                    f"Respond in 2-3 sentences only."
                ),
            },
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.9,
        "max_tokens": 512,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(SIMULATION_MODAL_ENDPOINT, json=payload)
            content = resp.json()["choices"][0]["message"]["content"]
            if "</think>" in content:
                content = content.split("</think>", 1)[1].strip()
            return content.strip()
        except Exception as exc:
            return f"[{agent_id} unavailable: {exc}]"


async def _run_simulation_task(graph_data: Optional[dict] = None) -> None:
    """Background task: run the full 5-day simulation."""
    global _sim_status, _sim_results

    try:
        if graph_data and graph_data.get("nodes"):
            graph = graph_data
        elif SIMULATION_GRAPH_PATH.exists():
            graph = json.loads(SIMULATION_GRAPH_PATH.read_text(encoding="utf-8"))
        else:
            _sim_status = {
                "state": "error", "progress": 0, "total": 0, "day": 0,
                "error": "No graph data and graph.json not found",
            }
            return

        nodes = graph.get("nodes", [])
        agent_map = {n["id"]: n for n in nodes}
        all_ids = [n["id"] for n in nodes]

        results: dict[str, list[dict]] = {aid: [] for aid in all_ids}
        current_messages: dict[str, str] = {}
        total_steps = SIMULATION_DAYS * len(all_ids)
        done = 0
        _sim_status = {
            "state": "running", "progress": 0, "total": total_steps, "day": 0, "error": "",
        }

        for day in range(SIMULATION_DAYS):
            _sim_status["day"] = day
            day_talked_to: dict[str, list[str]] = {}
            tasks, task_ids = [], []

            for agent_id in all_ids:
                agent = agent_map[agent_id]
                system_prompt = agent["metadata"].get("system_prompt", "")
                full_name = agent["metadata"].get("full_name", agent_id)
                neighbors = agent.get("connections", [])

                if day == 0:
                    incoming = [SIMULATION_NEWS_SPARK]
                    neighbor_names_for_call: list[str] = []
                    day_talked_to[agent_id] = []
                else:
                    active = [nid for nid in neighbors if nid in current_messages]
                    if not active:
                        active = [agent_id] if agent_id in current_messages else []
                    incoming = [current_messages[nid] for nid in active] if active else [SIMULATION_NEWS_SPARK]
                    neighbor_names_for_call = [
                        agent_map[nid]["metadata"].get("full_name", nid) for nid in active
                    ]
                    day_talked_to[agent_id] = [
                        agent_map[nid]["metadata"].get("full_name", nid)
                        for nid in active if nid != agent_id
                    ]

                tasks.append(_call_sim_agent(agent_id, system_prompt, full_name, incoming, neighbor_names_for_call))
                task_ids.append(agent_id)

            responses = await asyncio.gather(*tasks)

            next_messages: dict[str, str] = {}
            memory_tasks = []
            for agent_id, response in zip(task_ids, responses):
                next_messages[agent_id] = response
                results[agent_id].append({
                    "day": day,
                    "content": response,
                    "talked_to": day_talked_to.get(agent_id, []),
                })
                memory_tasks.append(_store_supermemory(agent_id, day, response))
                done += 1

            _sim_status["progress"] = done
            await asyncio.gather(*memory_tasks)
            current_messages = next_messages

        _sim_results = {}
        for agent_id in all_ids:
            meta = agent_map[agent_id]["metadata"]
            days_data = results[agent_id]
            _sim_results[agent_id] = {
                "agent_id": agent_id,
                "full_name": meta.get("full_name", agent_id),
                "days": days_data,
                "initial": days_data[0]["content"] if days_data else "",
                "final": days_data[-1]["content"] if days_data else "",
            }

        _sim_status = {
            "state": "done", "progress": total_steps, "total": total_steps,
            "day": SIMULATION_DAYS, "error": "",
        }

    except Exception as exc:
        _sim_status = {
            "state": "error", "progress": 0, "total": 0, "day": 0, "error": str(exc),
        }


class SimulationRunRequest(BaseModel):
    nodes: Optional[list[dict]] = None
    edges: Optional[list[dict]] = None


@app.post("/api/simulation/run")
async def simulation_run(background_tasks: BackgroundTasks, body: Optional[SimulationRunRequest] = None):
    global _sim_status, _sim_results
    if _sim_status["state"] == "running":
        return {"status": "already_running"}
    _sim_status = {"state": "running", "progress": 0, "total": 0, "day": 0, "error": ""}
    _sim_results = {}
    graph_data = {"nodes": body.nodes, "edges": body.edges or []} if body and body.nodes else None
    background_tasks.add_task(_run_simulation_task, graph_data)
    return {"status": "started"}


@app.get("/api/simulation/status")
async def simulation_status():
    return _sim_status


@app.get("/api/simulation/results")
async def simulation_results():
    if _sim_status["state"] != "done":
        raise HTTPException(status_code=425, detail="Simulation not complete yet.")
    return _sim_results
