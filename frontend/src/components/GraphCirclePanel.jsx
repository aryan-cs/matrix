import { useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

function clampNodeRadius(count) {
  if (count <= 12) return 18;
  if (count <= 28) return 14.5;
  if (count <= 70) return 11.75;
  if (count <= 140) return 9.5;
  return 8;
}

const DETAIL_FIELDS = [
  ["segment_key", "Segment"],
  ["age", "Age"],
  ["gender", "Gender"],
  ["ethnicity", "Ethnicity"],
  ["socioeconomic_status", "Socioeconomic Status"],
  ["household_income_usd", "Household Income"],
  ["household_structure", "Household"],
  ["education", "Education"],
  ["occupation", "Occupation"],
  ["political_lean", "Political Lean"],
  ["home_address", "Location"]
];

const TERMINAL_TYPE_INTERVAL_MS = 18;
const TERMINAL_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TERMINAL_SPINNER_INTERVAL_MS = 110;
const SUMMARY_DEFAULT_MODEL_ENDPOINT = "";
const SUMMARY_DEFAULT_MODEL_ID = "deepseek-r1";
const SUMMARY_DEFAULT_PROXY_PATH = "/api/planner/chat";
const AGENTS_ENDPOINT = "/api/avatar/agents";
const START_ENDPOINT = "/api/avatar/session/start";
const PORTRAIT_ENDPOINT = "/api/portrait";

const SUMMARY_MODEL_ENDPOINT = (
  import.meta.env.VITE_PLANNER_CONTEXT_ENDPOINT ||
  import.meta.env.VITE_PLANNER_MODEL_ENDPOINT ||
  SUMMARY_DEFAULT_MODEL_ENDPOINT
).trim();
const SUMMARY_MODEL_ID = (import.meta.env.VITE_PLANNER_MODEL_ID || SUMMARY_DEFAULT_MODEL_ID).trim();
const SUMMARY_API_KEY = (import.meta.env.VITE_PLANNER_API_KEY || "").trim();
const SUMMARY_PROXY_PATH = (
  import.meta.env.VITE_PLANNER_PROXY_PATH || SUMMARY_DEFAULT_PROXY_PATH
).trim();
const USE_SUMMARY_PROXY =
  import.meta.env.DEV && import.meta.env.VITE_USE_PLANNER_PROXY !== "false";

function plannerChatEndpointFor(baseOrEndpoint) {
  const trimmed = (baseOrEndpoint || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/v1/chat/completions")) return trimmed;
  return `${trimmed}/v1/chat/completions`;
}

function buildNodeSummaryContext(selectedNode, nodeById, adjacencyById) {
  if (!selectedNode) return null;

  const preferredConnections = Array.isArray(selectedNode.connections)
    ? selectedNode.connections
    : [];
  const fallbackConnections = Array.from(adjacencyById.get(selectedNode.id) || []);
  const rawConnectionIds =
    preferredConnections.length > 0 ? preferredConnections : fallbackConnections;
  const connectionIds = Array.from(
    new Set(
      rawConnectionIds
        .map((id) => String(id || "").trim())
        .filter((id) => id && id !== selectedNode.id)
    )
  );
  const connectionNames =
    connectionIds.length > 0
      ? connectionIds.map((id) => nodeById.get(id)?.label || id)
      : ["No direct connections listed."];

  const metadata =
    selectedNode.metadata && typeof selectedNode.metadata === "object"
      ? selectedNode.metadata
      : {};

  const lines = [];
  lines.push(`> agent_id: ${selectedNode.id}`);
  lines.push(`> name: ${selectedNode.label || selectedNode.id}`);

  for (const [key, label] of DETAIL_FIELDS) {
    const value = String(metadata[key] ?? "").trim();
    if (!value) continue;
    lines.push(`${label}: ${value}`);
  }

  return {
    agent_id: selectedNode.id,
    name: selectedNode.label || selectedNode.id,
    metadata,
    connection_names: connectionNames,
    display_lines: lines
  };
}

function buildFallbackSummary(context) {
  if (!context) return "";

  const metadata = context.metadata || {};
  const age = String(metadata.age || "").trim();
  const occupation = String(metadata.occupation || "").trim();
  const segment = String(metadata.segment_key || "").trim();
  const politicalLean = String(metadata.political_lean || "").trim();
  const priorities = String(metadata.policy_priorities || "").trim();
  const connections = Array.isArray(context.connection_names) ? context.connection_names : [];

  const line1Parts = [
    context.name,
    age ? `(${age})` : "",
    occupation ? `is a ${occupation}` : "is a representative agent",
    segment ? `in ${segment.replaceAll("_", " ")}` : ""
  ].filter(Boolean);
  const line2Parts = [
    politicalLean ? `Lean: ${politicalLean}.` : "",
    priorities ? `Priorities: ${priorities}.` : "",
    connections.length > 0
      ? `Likely talks with: ${connections.slice(0, 4).join(", ")}.`
      : "No direct network links were provided."
  ].filter(Boolean);

  const line1 = `> ${line1Parts.join(" ").replace(/\s+/g, " ").trim()}.`;
  const line2 = `> ${line2Parts.join(" ").replace(/\s+/g, " ").trim()}`;
  return `${line1}\n${line2}`;
}

function extractPostThinkText(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  if (!raw) return "";

  const closeTagRegex = /<\/think\s*>/gi;
  let lastCloseEnd = -1;
  let closeMatch = closeTagRegex.exec(raw);
  while (closeMatch) {
    lastCloseEnd = closeTagRegex.lastIndex;
    closeMatch = closeTagRegex.exec(raw);
  }

  if (lastCloseEnd !== -1) {
    return raw.slice(lastCloseEnd).trim();
  }

  // Fallback: remove any think blocks/tags if present, then return remaining text.
  return raw
    .replace(/<think\s*>[\s\S]*?<\/think\s*>/gi, "")
    .replace(/<think\s*>[\s\S]*$/gi, "")
    .replace(/<\/?think\s*>/gi, "")
    .trim();
}

function normalizeTwoLineSummary(summaryText, fallbackText) {
  const fallbackLines = String(fallbackText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const rawLines = String(summaryText || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/^[-*>\d.\)\s]+/, ""))
    .filter(Boolean);

  let lines = rawLines.slice(0, 2);
  if (lines.length < 2) {
    const sentenceSplit = String(summaryText || "")
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    lines = sentenceSplit.slice(0, 2);
  }
  if (lines.length < 2) {
    lines = fallbackLines.map((line) => line.replace(/^>\s*/, "")).slice(0, 2);
  }
  if (lines.length === 1) {
    lines.push("Summary unavailable.");
  }
  const joinedSummary = lines
    .slice(0, 2)
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .join("  |  ");
  return `> ${joinedSummary}`;
}

async function generateNodeSummaryWithLlm(context, signal) {
  const plannerEndpoint = plannerChatEndpointFor(SUMMARY_MODEL_ENDPOINT);
  const requestUrl = USE_SUMMARY_PROXY ? SUMMARY_PROXY_PATH : plannerEndpoint;
  if (!requestUrl) {
    throw new Error("Planner endpoint is not configured.");
  }

  const payload = {
    model: SUMMARY_MODEL_ID,
    temperature: 0.2,
    stream: false,
    messages: [
      {
        role: "system",
        content:
          "You summarize one simulated representative profile in exactly 2 lines. Keep each line concise, plain text, no markdown lists, no bullets, no numbering, no preamble, and no reasoning text."
      },
      {
        role: "user",
        content:
          "Using this node context, write exactly 2 lines that summarize this person and their network relevance.\n\n" +
          JSON.stringify(context, null, 2)
      }
    ]
  };

  const response = await fetch(requestUrl, {
    signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(!USE_SUMMARY_PROXY && SUMMARY_API_KEY
        ? { Authorization: `Bearer ${SUMMARY_API_KEY}` }
        : {})
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Summary endpoint responded ${response.status}`);
  }

  const parsed = await response.json();
  const rawContent = String(parsed?.choices?.[0]?.message?.content || "").trim();
  const postThinkContent = extractPostThinkText(rawContent);
  return postThinkContent || rawContent;
}

function normalizeGraphData(graph) {
  const providedNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const providedEdges = Array.isArray(graph?.edges) ? graph.edges : [];

  const nodes = providedNodes
    .map((node) => {
      const id = String(node?.id ?? "").trim();
      if (!id) return null;
      const metadata =
        node && typeof node.metadata === "object" && node.metadata !== null ? node.metadata : {};
      const label = String(
        node?.label ||
          metadata?.full_name ||
          metadata?.name ||
          metadata?.fullName ||
          id
      );
      const connections = Array.isArray(node?.connections)
        ? node.connections
            .map((connectionId) => String(connectionId || "").trim())
            .filter(Boolean)
        : [];

      return {
        id,
        label,
        metadata,
        connections
      };
    })
    .filter(Boolean);

  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const edges = [];
  const edgeKeys = new Set();

  const pushEdge = (leftIndex, rightIndex) => {
    if (leftIndex === rightIndex) return;
    const a = Math.min(leftIndex, rightIndex);
    const b = Math.max(leftIndex, rightIndex);
    const key = `${a}::${b}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ sourceIndex: a, targetIndex: b });
  };

  for (const edge of providedEdges) {
    const sourceId = String(edge?.source ?? edge?.from ?? edge?.src ?? "").trim();
    const targetId = String(edge?.target ?? edge?.to ?? edge?.dst ?? "").trim();
    if (!indexById.has(sourceId) || !indexById.has(targetId)) continue;
    pushEdge(indexById.get(sourceId), indexById.get(targetId));
  }

  for (let i = 0; i < nodes.length; i += 1) {
    const source = nodes[i];
    for (const targetId of source.connections) {
      if (!indexById.has(targetId)) continue;
      pushEdge(i, indexById.get(targetId));
    }
  }

  return { nodes, edges };
}

function fibonacciSpherePoint(index, count) {
  if (count <= 1) return { x: 0, y: 0, z: 1 };

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - ((index + 0.5) / count) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = goldenAngle * index;

  return {
    x: Math.cos(theta) * radius,
    y,
    z: Math.sin(theta) * radius
  };
}

function rotatePoint(point, rotX, rotY) {
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);

  const y1 = point.y * cosX - point.z * sinX;
  const z1 = point.y * sinX + point.z * cosX;

  const x2 = point.x * cosY + z1 * sinY;
  const z2 = -point.x * sinY + z1 * cosY;

  return { x: x2, y: y1, z: z2 };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function GraphCirclePanel({ graph = null }) {
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [terminalText, setTerminalText] = useState("");
  const [spinnerFrameIndex, setSpinnerFrameIndex] = useState(0);
  const [summaryCache, setSummaryCache] = useState({});
  const [summaryLoading, setSummaryLoading] = useState({});
  const [mappedAgentsById, setMappedAgentsById] = useState({});
  const [avatarStatus, setAvatarStatus] = useState("Select a node to preview avatar.");
  const [avatarError, setAvatarError] = useState("");
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const selectedNodeIdRef = useRef("");
  const zoomScaleRef = useRef(1);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const terminalScrollRef = useRef(null);
  const summaryRequestSeqRef = useRef(0);
  const roomRef = useRef(null);
  const audioSinkRef = useRef(null);
  const graphData = useMemo(() => normalizeGraphData(graph), [graph]);
  const nodeById = useMemo(
    () => new Map(graphData.nodes.map((node) => [node.id, node])),
    [graphData]
  );
  const adjacencyById = useMemo(() => {
    const adjacency = new Map(graphData.nodes.map((node) => [node.id, new Set()]));
    for (const edge of graphData.edges) {
      const source = graphData.nodes[edge.sourceIndex];
      const target = graphData.nodes[edge.targetIndex];
      if (!source || !target || source.id === target.id) continue;
      adjacency.get(source.id)?.add(target.id);
      adjacency.get(target.id)?.add(source.id);
    }
    return adjacency;
  }, [graphData]);
  const selectedNode = useMemo(
    () => (selectedNodeId ? nodeById.get(selectedNodeId) || null : null),
    [selectedNodeId, nodeById]
  );
  const terminalTargetText = useMemo(() => {
    const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : null;
    if (!selectedNode) return "";
    return summaryCache[selectedNodeId] || "";
  }, [selectedNodeId, nodeById, summaryCache]);
  const selectedMappedAgent = useMemo(() => {
    if (!selectedNodeId) return null;
    return mappedAgentsById[selectedNodeId] || null;
  }, [selectedNodeId, mappedAgentsById]);
  const selectedPortraitUrl = useMemo(() => {
    if (!selectedNodeId) return "";
    return `${PORTRAIT_ENDPOINT}/${encodeURIComponent(selectedNodeId)}`;
  }, [selectedNodeId]);
  const avatarContextOverride = useMemo(() => {
    if (!selectedNodeId || !selectedNode) return "";
    const cached = String(summaryCache[selectedNodeId] || "").trim();
    if (cached) return cached;
    const ctx = buildNodeSummaryContext(selectedNode, nodeById, adjacencyById);
    return String(buildFallbackSummary(ctx) || "").trim();
  }, [selectedNodeId, selectedNode, summaryCache, nodeById, adjacencyById]);
  const isSummaryPending = Boolean(selectedNodeId && !summaryCache[selectedNodeId]);

  const clearAudioSink = () => {
    const node = audioSinkRef.current;
    if (!node) return;
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  };

  const disconnectAvatar = () => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    clearAudioSink();
  };

  const attachTrack = (track) => {
    if (track.kind !== Track.Kind.Audio) {
      return;
    }

    const node = audioSinkRef.current;
    if (!node) return;
    const element = track.attach();
    element.classList.add("graph-node-avatar-track");
    element.classList.add("graph-node-avatar-audio-hidden");
    element.dataset.kind = "audio";
    element.autoplay = true;
    element.playsInline = true;
    element.controls = false;
    element.preload = "auto";
    element.muted = false;
    element.volume = 1;
    if (typeof element.play === "function") {
      element.play().catch(() => {
        // Browser autoplay policy can block hidden audio until a user gesture.
        setNeedsAudioUnlock(true);
      });
    }
    node.appendChild(element);
  };

  const unlockAudioPlayback = async () => {
    const sink = audioSinkRef.current;
    if (!sink) return;
    const mediaEls = Array.from(sink.querySelectorAll("audio,video"));
    let playedAny = false;
    for (const el of mediaEls) {
      if (typeof el.play !== "function") continue;
      try {
        await el.play();
        playedAny = true;
      } catch {
        // Keep trying remaining elements.
      }
    }
    if (playedAny) {
      setNeedsAudioUnlock(false);
      setAvatarStatus(`Avatar ready for ${selectedNodeId}.`);
    }
  };

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    if (selectedNodeId && !nodeById.has(selectedNodeId)) {
      setSelectedNodeId("");
    }
  }, [selectedNodeId, nodeById]);

  useEffect(() => {
    let cancelled = false;

    const loadMappedAgents = async () => {
      try {
        const response = await fetch(AGENTS_ENDPOINT);
        if (!response.ok) return;
        const data = await response.json();
        const list = Array.isArray(data?.agents) ? data.agents : [];
        const byId = {};
        for (const item of list) {
          const id = String(item?.agent_id || "").trim();
          if (!id) continue;
          byId[id] = item;
        }
        if (!cancelled) {
          setMappedAgentsById(byId);
        }
      } catch {
        // Leave graph summary UI functional even if avatar API is unavailable.
      }
    };

    loadMappedAgents();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const startAvatarForSelectedNode = async () => {
      if (!selectedNodeId) {
        disconnectAvatar();
        setAvatarError("");
        setNeedsAudioUnlock(false);
        setAvatarStatus("Select a node to preview avatar.");
        return;
      }

      if (!selectedMappedAgent) {
        disconnectAvatar();
        setAvatarError("");
        setNeedsAudioUnlock(false);
        setAvatarStatus(`No avatar mapping found for ${selectedNodeId}.`);
        return;
      }

      disconnectAvatar();
      setAvatarError("");
      setNeedsAudioUnlock(false);
      setAvatarStatus(`Starting avatar for ${selectedNodeId}...`);

      try {
        const response = await fetch(START_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: selectedNodeId,
            context_override: avatarContextOverride || undefined,
          })
        });
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(`Session start failed (${response.status}): ${detail}`);
        }

        const started = await response.json();
        if (cancelled) return;

        const room = new Room({ adaptiveStream: true, dynacast: true });
        room.on(RoomEvent.TrackSubscribed, (track) => attachTrack(track));
        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((el) => el.remove());
        });
        room.on(RoomEvent.ConnectionStateChanged, (state) => {
          if (!cancelled) {
            setAvatarStatus(`Avatar connection: ${state}`);
          }
        });
        room.on(RoomEvent.Disconnected, () => {
          if (!cancelled) {
            setAvatarStatus("Avatar disconnected.");
          }
        });

        await room.connect(started.livekit_url, started.livekit_client_token);
        if (cancelled) {
          room.disconnect();
          return;
        }

        // Match the proven tester behavior: publish local media so avatar agent can respond.
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch {
          // Permission denied or unavailable; keep session alive for remote avatar playback.
        }
        try {
          await room.localParticipant.setCameraEnabled(true);
        } catch {
          // Optional for this preview mode.
        }

        room.remoteParticipants.forEach((participant) => {
          participant.trackPublications.forEach((publication) => {
            if (publication.isSubscribed && publication.track) {
              attachTrack(publication.track);
            }
          });
        });

        roomRef.current = room;
        setAvatarStatus(`Avatar ready for ${selectedNodeId}.`);
      } catch (error) {
        if (cancelled) return;
        disconnectAvatar();
        setAvatarError(error instanceof Error ? error.message : "Could not start avatar.");
        setAvatarStatus("Avatar failed to start.");
      }
    };

    startAvatarForSelectedNode();

    return () => {
      cancelled = true;
      disconnectAvatar();
    };
  }, [selectedNodeId, selectedMappedAgent, avatarContextOverride]);

  useEffect(() => {
    return () => disconnectAvatar();
  }, []);

  useEffect(() => {
    const activeNodeId = selectedNodeId;
    const selectedNode = activeNodeId ? nodeById.get(activeNodeId) : null;
    if (!selectedNode || summaryCache[activeNodeId] || summaryLoading[activeNodeId]) {
      return undefined;
    }

    const context = buildNodeSummaryContext(selectedNode, nodeById, adjacencyById);
    const fallbackSummary = buildFallbackSummary(context);
    const requestSeq = summaryRequestSeqRef.current + 1;
    summaryRequestSeqRef.current = requestSeq;
    const controller = new AbortController();

    setSummaryLoading((prev) => ({ ...prev, [activeNodeId]: true }));

    (async () => {
      try {
        const rawSummary = await generateNodeSummaryWithLlm(context, controller.signal);
        if (controller.signal.aborted) return;
        if (summaryRequestSeqRef.current !== requestSeq) return;
        const normalized = normalizeTwoLineSummary(rawSummary, fallbackSummary);
        setSummaryCache((prev) => ({ ...prev, [activeNodeId]: normalized }));
      } catch {
        if (controller.signal.aborted) return;
        if (summaryRequestSeqRef.current !== requestSeq) return;
        setSummaryCache((prev) => ({ ...prev, [activeNodeId]: fallbackSummary }));
      } finally {
        setSummaryLoading((prev) => ({ ...prev, [activeNodeId]: false }));
      }
    })();

    return () => {
      controller.abort();
      setSummaryLoading((prev) => ({ ...prev, [activeNodeId]: false }));
    };
  }, [selectedNodeId, nodeById, adjacencyById, summaryCache]);

  useEffect(() => {
    if (!isSummaryPending) return undefined;

    setSpinnerFrameIndex(0);
    const timerId = window.setInterval(() => {
      setSpinnerFrameIndex((prev) => (prev + 1) % TERMINAL_SPINNER_FRAMES.length);
    }, TERMINAL_SPINNER_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isSummaryPending]);

  useEffect(() => {
    if (!selectedNodeId || !terminalTargetText) {
      setTerminalText("");
      return undefined;
    }

    let charIndex = 0;
    setTerminalText("");

    const timerId = window.setInterval(() => {
      const remaining = terminalTargetText.length - charIndex;
      if (remaining <= 0) {
        window.clearInterval(timerId);
        return;
      }

      const step = Math.max(1, Math.min(3, Math.ceil(remaining / 36)));
      charIndex = Math.min(terminalTargetText.length, charIndex + step);
      setTerminalText(terminalTargetText.slice(0, charIndex));

      if (charIndex >= terminalTargetText.length) {
        window.clearInterval(timerId);
      }
    }, TERMINAL_TYPE_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [selectedNodeId, terminalTargetText]);

  useEffect(() => {
    const terminalNode = terminalScrollRef.current;
    if (!terminalNode) return;
    terminalNode.scrollTop = terminalNode.scrollHeight;
  }, [terminalText]);

  useEffect(() => {
    const stageNode = stageRef.current;
    const canvasNode = canvasRef.current;
    if (!stageNode || !canvasNode) return undefined;

    const context = canvasNode.getContext("2d");
    if (!context) return undefined;

    const engine = {
      width: 1,
      height: 1,
      dpr: 1,
      centerX: 0,
      centerY: 0,
      baseSphereRadius: 1,
      sphereRadius: 1,
      cameraDistance: 1,
      zoomScale: zoomScaleRef.current,
      nodes: [],
      edges: graphData.edges,
      rotationX: -0.34,
      rotationY: 0.42,
      velocityX: 0,
      velocityY: 0,
      activePointerId: null,
      isDragging: false,
      dragDistanceSq: 0,
      lastPointerX: 0,
      lastPointerY: 0,
      rafId: 0
    };

    let resizeRafId = 0;

    const updateProjectionScale = () => {
      const clampedZoom = clamp(engine.zoomScale, 0.55, 2.7);
      engine.zoomScale = clampedZoom;
      zoomScaleRef.current = clampedZoom;
      engine.sphereRadius = Math.max(28, engine.baseSphereRadius * clampedZoom);
      engine.cameraDistance = engine.sphereRadius * 3.1;
    };

    const setCanvasViewport = (width, height) => {
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      const viewportChanged = engine.width !== width || engine.height !== height || engine.dpr !== dpr;
      if (!viewportChanged) return;

      engine.width = width;
      engine.height = height;
      engine.dpr = dpr;
      const panelTightness = clamp((width - 300) / 420, 0, 1);
      const leftInset = clamp(width * 0.08, 10, 52);
      const rightLabelGutter = clamp(width * (0.14 + panelTightness * 0.18), 34, 190);
      const drawableWidth = Math.max(92, width - leftInset - rightLabelGutter);
      engine.centerX = leftInset + drawableWidth * 0.5;
      engine.centerY = height * 0.5;
      const radiusByWidth = drawableWidth * 0.36;
      const radiusByHeight = height * 0.3;
      engine.baseSphereRadius = Math.max(30, Math.min(radiusByWidth, radiusByHeight));
      updateProjectionScale();

      canvasNode.width = Math.round(width * dpr);
      canvasNode.height = Math.round(height * dpr);
      canvasNode.style.width = `${width}px`;
      canvasNode.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const setupNodes = () => {
      const compactScale = clamp(engine.width / 620, 0.62, 1);
      const baseRadius = clampNodeRadius(graphData.nodes.length) * compactScale;
      engine.nodes = graphData.nodes.map((node, index) => ({
        id: node.id,
        label: node.label || node.id,
        base: fibonacciSpherePoint(index, graphData.nodes.length),
        x: 0,
        y: 0,
        z: 0,
        depth: 0,
        scale: 1,
        radius: baseRadius
      }));
    };

    const projectNodes = () => {
      const denominatorFloor = Math.max(80, engine.cameraDistance * 0.18);

      for (const node of engine.nodes) {
        const rotated = rotatePoint(node.base, engine.rotationX, engine.rotationY);
        const worldX = rotated.x * engine.sphereRadius;
        const worldY = rotated.y * engine.sphereRadius;
        const worldZ = rotated.z * engine.sphereRadius;
        const denominator = Math.max(denominatorFloor, engine.cameraDistance - worldZ);
        const perspective = engine.cameraDistance / denominator;
        const depth = (worldZ / Math.max(engine.sphereRadius, 1) + 1) * 0.5;

        node.x = engine.centerX + worldX * perspective;
        node.y = engine.centerY + worldY * perspective;
        node.z = worldZ;
        node.scale = perspective;
        node.depth = clamp(depth, 0, 1);
      }
    };

    const pickNodeAt = (x, y) => {
      let bestIndex = -1;
      let bestDistanceSq = Number.POSITIVE_INFINITY;

      for (let i = 0; i < engine.nodes.length; i += 1) {
        const node = engine.nodes[i];
        const visualRadius = node.radius * (0.72 + node.depth * 0.56);
        const maxGrab = visualRadius + 10;
        const dx = x - node.x;
        const dy = y - node.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq > maxGrab * maxGrab) continue;
        if (distanceSq >= bestDistanceSq) continue;
        bestDistanceSq = distanceSq;
        bestIndex = i;
      }

      return bestIndex;
    };

    const pointerPositionFor = (event) => {
      const bounds = canvasNode.getBoundingClientRect();
      return {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      };
    };

    const onPointerDown = (event) => {
      const pointer = pointerPositionFor(event);
      engine.activePointerId = event.pointerId;
      engine.isDragging = true;
      engine.dragDistanceSq = 0;
      engine.lastPointerX = pointer.x;
      engine.lastPointerY = pointer.y;
      engine.velocityX = 0;
      engine.velocityY = 0;
      canvasNode.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event) => {
      if (!engine.isDragging || event.pointerId !== engine.activePointerId) return;
      const pointer = pointerPositionFor(event);
      const dx = pointer.x - engine.lastPointerX;
      const dy = pointer.y - engine.lastPointerY;

      engine.dragDistanceSq += dx * dx + dy * dy;
      engine.lastPointerX = pointer.x;
      engine.lastPointerY = pointer.y;

      engine.rotationY += dx * 0.0057;
      engine.rotationX -= dy * 0.0052;
      engine.rotationX = clamp(engine.rotationX, -1.24, 1.24);

      engine.velocityY = dx * 0.00028;
      engine.velocityX = -dy * 0.00028;
    };

    const onPointerUp = (event) => {
      if (event.pointerId !== engine.activePointerId) return;
      if (canvasNode.hasPointerCapture(event.pointerId)) {
        canvasNode.releasePointerCapture(event.pointerId);
      }
      engine.isDragging = false;
      engine.activePointerId = null;

      if (engine.dragDistanceSq <= 18) {
        const pointer = pointerPositionFor(event);
        const hitIndex = pickNodeAt(pointer.x, pointer.y);
        if (hitIndex === -1) {
          setSelectedNodeId("");
        } else {
          setSelectedNodeId(engine.nodes[hitIndex].id);
        }
      }
    };

    const onWheel = (event) => {
      if (!event) return;
      event.preventDefault();

      const unitScale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(window.innerHeight, 1) : 1;
      const normalizedDelta = event.deltaY * unitScale;
      const zoomFactor = Math.exp(-normalizedDelta * 0.0014);
      const nextZoom = clamp(engine.zoomScale * zoomFactor, 0.55, 2.7);
      if (Math.abs(nextZoom - engine.zoomScale) < 0.0001) return;
      engine.zoomScale = nextZoom;
      updateProjectionScale();
    };

    const draw = () => {
      context.clearRect(0, 0, engine.width, engine.height);
      if (engine.nodes.length === 0) return;

      projectNodes();

      const sortedEdges = [...engine.edges].sort((leftEdge, rightEdge) => {
        const leftDepth =
          (engine.nodes[leftEdge.sourceIndex]?.z ?? 0) + (engine.nodes[leftEdge.targetIndex]?.z ?? 0);
        const rightDepth =
          (engine.nodes[rightEdge.sourceIndex]?.z ?? 0) + (engine.nodes[rightEdge.targetIndex]?.z ?? 0);
        return leftDepth - rightDepth;
      });

      for (const edge of sortedEdges) {
        const source = engine.nodes[edge.sourceIndex];
        const target = engine.nodes[edge.targetIndex];
        if (!source || !target) continue;

        const avgDepth = (source.depth + target.depth) * 0.5;

        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.strokeStyle = `rgba(255, 255, 255, ${0.08 + avgDepth * 0.2})`;
        context.lineWidth = 0.75 + avgDepth * 0.9;
        context.stroke();
      }

      const sortedNodes = [...engine.nodes].sort((left, right) => left.z - right.z);
      for (const node of sortedNodes) {
        const isSelected = node.id === selectedNodeIdRef.current;
        const visualRadius = node.radius * (0.74 + node.depth * 0.56) + (isSelected ? 1.4 : 0);
        const nodeShade = Math.round(86 + node.depth * 169);

        context.beginPath();
        context.arc(node.x, node.y, visualRadius, 0, Math.PI * 2);
        context.fillStyle = `rgb(${nodeShade}, ${nodeShade}, ${nodeShade})`;
        context.fill();

        if (isSelected) {
          context.beginPath();
          context.arc(node.x, node.y, visualRadius + 2.2, 0, Math.PI * 2);
          context.strokeStyle = "rgba(255, 255, 255, 0.72)";
          context.lineWidth = 1.1;
          context.stroke();
        }

        const labelVisibility = clamp((engine.width - 240) / 180, 0, 1);
        if (labelVisibility > 0.02) {
          const labelScale = 0.72 + labelVisibility * 0.28;
          const nameFontSize = Math.max(
            8,
            Math.min(13, Math.floor((visualRadius * 0.52 + 5) * labelScale))
          );
          const idFontSize = Math.max(8, Math.floor(nameFontSize * 0.86));
          const labelOffset = 4 + labelVisibility * 4;
          const nameY = node.y - visualRadius - (1 + (1 - labelVisibility) * 1.5);
          const idY = nameY + Math.max(10, Math.floor(nameFontSize * 1.08));
          const maxLabelWidth = Math.min(engine.width * 0.4, 180);
          const rawRightX = node.x + visualRadius + labelOffset;
          let labelX = rawRightX;
          let labelAlign = "left";
          if (rawRightX + maxLabelWidth > engine.width - 6) {
            labelAlign = "right";
            labelX = node.x - visualRadius - labelOffset;
          }

          context.font = `500 ${nameFontSize}px "Google Sans", sans-serif`;
          context.textAlign = labelAlign;
          context.textBaseline = "alphabetic";
          context.fillStyle = `rgba(255, 255, 255, ${(0.42 + node.depth * 0.3) * labelVisibility})`;
          context.fillText(node.label || node.id, labelX, nameY);

          context.font = `500 ${idFontSize}px "Google Sans Code", "Google Sans", ui-monospace, monospace`;
          context.fillStyle = `rgba(190, 190, 190, ${(0.4 + node.depth * 0.28) * labelVisibility})`;
          context.fillText(node.id, labelX, idY);
        }
      }
    };

    const animate = () => {
      if (!engine.isDragging) {
        engine.rotationX += engine.velocityX;
        engine.rotationY += engine.velocityY;
        engine.rotationX = clamp(engine.rotationX, -1.24, 1.24);
        engine.velocityX *= 0.94;
        engine.velocityY *= 0.94;
        if (Math.abs(engine.velocityX) < 0.000004) engine.velocityX = 0;
        if (Math.abs(engine.velocityY) < 0.000004) engine.velocityY = 0;
      }

      draw();
      engine.rafId = window.requestAnimationFrame(animate);
    };

    const syncLayoutToStage = () => {
      const width = Math.max(1, stageNode.clientWidth);
      const height = Math.max(1, stageNode.clientHeight);
      const nextDpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      const viewportChanged = width !== engine.width || height !== engine.height || nextDpr !== engine.dpr;
      if (!viewportChanged) return;
      setCanvasViewport(width, height);
      setupNodes();
    };

    setCanvasViewport(Math.max(1, stageNode.clientWidth), Math.max(1, stageNode.clientHeight));
    setupNodes();

    const resizeObserver = new ResizeObserver(() => {
      if (resizeRafId) return;
      resizeRafId = window.requestAnimationFrame(() => {
        resizeRafId = 0;
        syncLayoutToStage();
      });
    });
    resizeObserver.observe(stageNode);

    canvasNode.addEventListener("pointerdown", onPointerDown);
    canvasNode.addEventListener("pointermove", onPointerMove);
    canvasNode.addEventListener("pointerup", onPointerUp);
    canvasNode.addEventListener("pointercancel", onPointerUp);
    canvasNode.addEventListener("wheel", onWheel, { passive: false });

    animate();

    return () => {
      resizeObserver.disconnect();
      canvasNode.removeEventListener("pointerdown", onPointerDown);
      canvasNode.removeEventListener("pointermove", onPointerMove);
      canvasNode.removeEventListener("pointerup", onPointerUp);
      canvasNode.removeEventListener("pointercancel", onPointerUp);
      canvasNode.removeEventListener("wheel", onWheel);
      window.cancelAnimationFrame(engine.rafId);
      if (resizeRafId) {
        window.cancelAnimationFrame(resizeRafId);
      }
    };
  }, [graphData]);

  const resolvedCount = graphData.nodes.length;
  const isTerminalOpen = Boolean(selectedNodeId);

  return (
    <div className={`graph-circle-canvas ${isTerminalOpen ? "terminal-open" : ""}`}>
      <div className="graph-circle-stage" ref={stageRef}>
        {resolvedCount === 0 ? (
          <p className="graph-circle-empty">No valid network graph data found in generated CSV.</p>
        ) : null}
        <canvas ref={canvasRef} className="graph-circle-canvas-element" />
      </div>
      <div
        className={`graph-node-terminal ${isTerminalOpen ? "open" : ""}`}
        aria-hidden={!isTerminalOpen}
      >
        <div className="graph-node-terminal-scroll" ref={terminalScrollRef}>
          <div className="graph-node-avatar">
            <div className="graph-node-avatar-media">
              {selectedPortraitUrl ? (
                <img
                  key={selectedPortraitUrl}
                  src={selectedPortraitUrl}
                  alt={`Portrait of ${selectedNodeId}`}
                  className="graph-node-portrait-image"
                  loading="lazy"
                />
              ) : null}
            </div>
            <div ref={audioSinkRef} />
            <p className="graph-node-avatar-status">{avatarStatus}</p>
            {needsAudioUnlock ? (
              <button type="button" className="graph-node-audio-unlock" onClick={unlockAudioPlayback}>
                Enable Voice
              </button>
            ) : null}
            {avatarError ? <p className="graph-node-avatar-error">{avatarError}</p> : null}
            {selectedMappedAgent ? (
              <p className="graph-node-avatar-meta">
                {selectedMappedAgent.avatar_name} ({selectedMappedAgent.avatar_id})
              </p>
            ) : null}
          </div>
          <pre className="graph-node-terminal-text">
            {isSummaryPending ? (
              <>
                {`$ Loading profile summary... ${TERMINAL_SPINNER_FRAMES[spinnerFrameIndex]}`}
                <span className="graph-node-terminal-caret" aria-hidden="true">
                  ▋
                </span>
              </>
            ) : (
              <>
                {terminalText}
                {isTerminalOpen && terminalText.length < terminalTargetText.length ? (
                  <span className="graph-node-terminal-caret" aria-hidden="true">
                    ▋
                  </span>
                ) : null}
              </>
            )}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default GraphCirclePanel;
