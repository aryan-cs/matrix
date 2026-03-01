import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import callIcon from "../../assets/icons/call.svg";
import notesIcon from "../../assets/icons/notes.svg";

const AVATAR_AGENTS_ENDPOINT = "/api/avatar/agents";
const AVATAR_START_ENDPOINT = "/api/avatar/session/start";

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

function formatDetailValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized || "—";
}

function buildNodeDetailRows(selectedNode, nodeById, adjacencyById) {
  if (!selectedNode) return [];

  const metadata =
    selectedNode.metadata && typeof selectedNode.metadata === "object"
      ? selectedNode.metadata
      : {};
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
  const connectionNames = connectionIds.map((id) => nodeById.get(id)?.label || id);

  const detailRows = [{ key: "agent_id", label: "Agent ID", value: selectedNode.id }];
  for (const [key, label] of DETAIL_FIELDS) {
    detailRows.push({
      key,
      label,
      value: formatDetailValue(metadata[key])
    });
  }
  detailRows.push({
    key: "connected_nodes",
    label: "Connected Nodes",
    value: connectionNames.length > 0 ? connectionNames.join(", ") : "—"
  });

  return detailRows;
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

function buildAvatarContext(selectedNode, simulationEntry) {
  const metadata =
    selectedNode?.metadata && typeof selectedNode.metadata === "object"
      ? selectedNode.metadata
      : {};
  const lines = [];
  const name = selectedNode?.label || metadata.full_name || selectedNode?.id || "Unknown";
  const agentId = selectedNode?.id || "";

  lines.push(`You are ${name} (${agentId}). Stay fully in character at all times.`);
  lines.push("These beliefs, experiences, and social ties are your own lived reality.");
  lines.push("Speak in first person as this person, not as an analyst or narrator.");

  const details = [
    ["Age", metadata.age],
    ["Gender", metadata.gender],
    ["Ethnicity", metadata.ethnicity],
    ["Political Lean", metadata.political_lean],
    ["Education", metadata.education],
    ["Occupation", metadata.occupation],
    ["Location", metadata.home_address]
  ]
    .filter(([, value]) => String(value ?? "").trim())
    .map(([label, value]) => `${label}: ${String(value).trim()}`);
  if (details.length > 0) {
    lines.push("");
    lines.push("Profile:");
    lines.push(...details);
  }

  if (simulationEntry) {
    lines.push("");
    lines.push("Simulation timeline:");
    if (simulationEntry.initial) {
      lines.push(`Day 0 (Initial): ${simulationEntry.initial}`);
    }
    if (Array.isArray(simulationEntry.days)) {
      for (const day of simulationEntry.days) {
        const dayIndex = Number(day?.day);
        const dayLabel = Number.isFinite(dayIndex) ? `Day ${dayIndex + 1}` : "Day";
        const talkedTo = Array.isArray(day?.talked_to) ? day.talked_to.filter(Boolean) : [];
        if (talkedTo.length > 0) {
          lines.push(`${dayLabel} talked to: ${talkedTo.join(", ")}`);
        }
        if (day?.content) {
          lines.push(`${dayLabel} summary: ${day.content}`);
        }
      }
    }
    if (simulationEntry.final) {
      lines.push(`Final position: ${simulationEntry.final}`);
    }
  }

  lines.push("");
  lines.push("Conversation rules:");
  lines.push("- Never say you are an AI, assistant, model, or that you are roleplaying.");
  lines.push("- Never refer to 'the simulation', 'the provided context', or 'the report'.");
  lines.push("- Express values, concerns, and decisions as your own personal views.");
  lines.push("- Keep tone natural and human; use concrete details from your life and relationships when relevant.");
  lines.push("- Respond conversationally in 2-4 sentences unless asked for detail.");
  return lines.join("\n");
}

function SimulationJourney({ data }) {
  if (!data || !data.days || data.days.length === 0) return null;
  const [expandedDay, setExpandedDay] = useState(-1);

  return (
    <div className="sim-journey">
      <div className="sim-journey-header">Simulation Journey</div>

      <div className="sim-section">
        <div className="sim-section-label">Initial Reaction — Day 0</div>
        <div className="sim-section-text">{data.initial}</div>
      </div>

      {data.days.length > 2 && (
        <div className="sim-section">
          <div className="sim-section-label">Evolution</div>
          <div className="sim-day-list">
            {data.days.slice(1, -1).map((d) => (
              <button
                key={d.day}
                type="button"
                className={`sim-day-chip ${expandedDay === d.day ? "active" : ""}`}
                onClick={() => setExpandedDay(expandedDay === d.day ? -1 : d.day)}
              >
                Day {d.day + 1}
              </button>
            ))}
          </div>
          {expandedDay >= 0 && (() => {
            const dayData = data.days.find((d) => d.day === expandedDay);
            if (!dayData) return null;
            return (
              <div className="sim-day-expanded">
                {dayData.talked_to?.length > 0 && (
                  <div className="sim-talked-to">Talked to: {dayData.talked_to.join(", ")}</div>
                )}
                <div>{dayData.content}</div>
              </div>
            );
          })()}
        </div>
      )}

      <div className="sim-section final">
        <div className="sim-section-label">Final Position — Day {data.days.length}</div>
        {data.days[data.days.length - 1]?.talked_to?.length > 0 && (
          <div className="sim-talked-to">
            Talked to: {data.days[data.days.length - 1].talked_to.join(", ")}
          </div>
        )}
        <div className="sim-section-text">{data.final}</div>
      </div>
    </div>
  );
}

function GraphCirclePanel({ graph = null, simulationData = null, simulationStatus = null }) {
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [journeyModalOpen, setJourneyModalOpen] = useState(false);
  const [avatarAgents, setAvatarAgents] = useState([]);
  const [callCardOpen, setCallCardOpen] = useState(false);
  const [activeCallAgentId, setActiveCallAgentId] = useState("");
  const [callStatus, setCallStatus] = useState("");
  const [callError, setCallError] = useState("");
  const [isStartingCall, setIsStartingCall] = useState(false);
  const [useVideoFeed, setUseVideoFeed] = useState(false);
  const [portraitFailed, setPortraitFailed] = useState(false);
  const selectedNodeIdRef = useRef("");
  const zoomScaleRef = useRef(1);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const roomRef = useRef(null);
  const videoHostRef = useRef(null);
  const audioHostRef = useRef(null);
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
  const selectedNodeDetails = useMemo(
    () => buildNodeDetailRows(selectedNode, nodeById, adjacencyById),
    [selectedNode, nodeById, adjacencyById]
  );
  const detailColumns = useMemo(() => {
    if (selectedNodeDetails.length === 0) return [[], []];
    const midpoint = Math.ceil(selectedNodeDetails.length / 2);
    return [selectedNodeDetails.slice(0, midpoint), selectedNodeDetails.slice(midpoint)];
  }, [selectedNodeDetails]);
  const avatarAgentById = useMemo(
    () => new Map((Array.isArray(avatarAgents) ? avatarAgents : []).map((agent) => [agent.agent_id, agent])),
    [avatarAgents]
  );
  const selectedSimulation = selectedNodeId ? simulationData?.[selectedNodeId] ?? null : null;
  const selectedAvatarAgent = selectedNodeId ? avatarAgentById.get(selectedNodeId) ?? null : null;
  const activePortraitSrc = activeCallAgentId ? `/api/portrait/${encodeURIComponent(activeCallAgentId)}` : "";
  const loadAvatarAgents = useCallback(async () => {
    try {
      const response = await fetch(AVATAR_AGENTS_ENDPOINT);
      if (!response.ok) {
        setAvatarAgents([]);
        return;
      }
      const payload = await response.json();
      setAvatarAgents(Array.isArray(payload?.agents) ? payload.agents : []);
    } catch {
      setAvatarAgents([]);
    }
  }, []);

  const clearMediaHosts = () => {
    const videoHost = videoHostRef.current;
    if (videoHost) {
      while (videoHost.firstChild) {
        videoHost.removeChild(videoHost.firstChild);
      }
    }
    const audioHost = audioHostRef.current;
    if (audioHost) {
      while (audioHost.firstChild) {
        audioHost.removeChild(audioHost.firstChild);
      }
    }
  };

  const disconnectCall = () => {
    const room = roomRef.current;
    if (room) {
      room.disconnect();
      roomRef.current = null;
    }
    clearMediaHosts();
    setCallCardOpen(false);
    setActiveCallAgentId("");
    setCallStatus("");
    setCallError("");
    setPortraitFailed(false);
  };

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
    setJourneyModalOpen(false);
  }, [selectedNodeId]);

  useEffect(() => {
    // Only one active call at a time: changing to a different node closes the current call.
    if (!activeCallAgentId || !selectedNodeId) return;
    if (selectedNodeId === activeCallAgentId) return;
    disconnectCall();
  }, [selectedNodeId, activeCallAgentId]);

  useEffect(() => {
    if (selectedNodeId && !nodeById.has(selectedNodeId)) {
      setSelectedNodeId("");
    }
  }, [selectedNodeId, nodeById]);

  useEffect(() => {
    void loadAvatarAgents();
  }, [loadAvatarAgents]);

  useEffect(() => {
    if (simulationStatus?.state !== "done") return;
    void loadAvatarAgents();
  }, [simulationStatus?.state, graphData.nodes.length, loadAvatarAgents]);

  useEffect(() => () => disconnectCall(), []);

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
      edgeDashOffset: 0,
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
        const dashSize = 3.5 + avgDepth * 2.4;
        const gapSize = 6 + (1 - avgDepth) * 2.2;

        context.beginPath();
        context.setLineDash([dashSize, gapSize]);
        context.lineDashOffset = -(engine.edgeDashOffset + avgDepth * 8);
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.strokeStyle = `rgba(255, 255, 255, ${0.08 + avgDepth * 0.2})`;
        context.lineWidth = 0.75 + avgDepth * 0.9;
        context.stroke();
      }
      context.setLineDash([]);
      context.lineDashOffset = 0;

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
      engine.edgeDashOffset += 0.18;

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

  const simRunning = simulationStatus?.state === "running";
  const simDone = simulationStatus?.state === "done";
  const simDay = simulationStatus?.day || 0;
  const simBarFill = simRunning ? Math.round((simDay / 5) * 100) : simDone ? 100 : 0;
  const canCallSelectedNode = Boolean(simDone && selectedNodeId && selectedSimulation && selectedAvatarAgent);

  const attachTrack = (track, shouldShowVideo) => {
    if (track.kind === Track.Kind.Video) {
      if (!shouldShowVideo) return;
      const videoHost = videoHostRef.current;
      if (!videoHost) return;
      const element = track.attach();
      element.classList.add("graph-call-card-track");
      videoHost.appendChild(element);
      return;
    }
    if (track.kind === Track.Kind.Audio) {
      const audioHost = audioHostRef.current;
      if (!audioHost) return;
      const element = track.attach();
      element.classList.add("graph-call-card-audio");
      element.autoplay = true;
      element.controls = false;
      element.muted = false;
      audioHost.appendChild(element);
    }
  };

  const handleStartCall = async () => {
    if (!canCallSelectedNode || !selectedNode) return;
    const simulationReportForNode = simulationData?.[selectedNode.id];
    if (!simulationReportForNode) return;
    setIsStartingCall(true);
    setCallError("");
    setPortraitFailed(false);
    setCallCardOpen(true);
    setActiveCallAgentId(selectedNode.id);
    clearMediaHosts();
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    const personName = selectedNode.label || selectedNode.id;
    setCallStatus(`${personName} is connecting…`);

    try {
      // Context uses this node's generated simulation report (same source as the report/journey button).
      const contextOverride = buildAvatarContext(selectedNode, simulationReportForNode);
      const response = await fetch(AVATAR_START_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: selectedNode.id,
          context_override: contextOverride
        })
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Call start failed (${response.status}): ${detail}`);
      }
      const started = await response.json();
      const shouldShowVideo = Boolean(selectedAvatarAgent?.live_video_enabled);
      setUseVideoFeed(shouldShowVideo);

      const room = new Room({ adaptiveStream: true, dynacast: true });
      room.on(RoomEvent.TrackSubscribed, (track) => attachTrack(track, shouldShowVideo));
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
      });
      room.on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === "connected") {
          setCallStatus(`${personName} is live`);
        } else if (state === "connecting") {
          setCallStatus(`${personName} is connecting…`);
        } else if (state === "disconnected") {
          setCallStatus(`${personName} disconnected`);
        }
      });
      await room.connect(started.livekit_url, started.livekit_client_token);
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        // Keep call active even if browser blocks mic access.
      }
      try {
        await room.localParticipant.setCameraEnabled(false);
      } catch {
        // Ignore camera disable errors.
      }
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (publication.isSubscribed && publication.track) {
            attachTrack(publication.track, shouldShowVideo);
          }
        });
      });
      roomRef.current = room;
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Could not start call.");
      setCallStatus(`${personName} could not connect`);
    } finally {
      setIsStartingCall(false);
    }
  };

  return (
    <div className={`graph-circle-canvas ${isTerminalOpen ? "terminal-open" : ""}`}>
      <div className="graph-circle-stage" ref={stageRef}>
        {resolvedCount === 0 ? (
          <p className="graph-circle-empty">No valid network graph data found in generated CSV.</p>
        ) : null}
        <canvas ref={canvasRef} className="graph-circle-canvas-element" />
      </div>

      {(simRunning || simDone) && (
        <div className={`sim-status-bar ${simDone ? "done" : ""}`}>
          <div className="sim-status-bar-track">
            <div className="sim-status-bar-fill" style={{ width: `${simBarFill}%` }} />
          </div>
          <span className="sim-status-label">
            {simRunning
              ? `Simulating… Day ${simDay + 1} / 5`
              : "Simulation complete"}
          </span>
        </div>
      )}

      <div className="graph-panel-fab-stack" aria-label="Graph actions">
        <button
          type="button"
          className={`graph-panel-fab ${!simDone ? "sim-locked" : ""}`}
          aria-label="Call"
          disabled={!canCallSelectedNode || isStartingCall}
          title={
            !simDone
              ? "Available after simulation completes"
              : !selectedNodeId
                ? "Select a person first"
                : !selectedSimulation
                  ? "No simulation report for this person"
                  : !selectedAvatarAgent
                    ? "No avatar mapping for this person"
                    : "Call"
          }
          onClick={handleStartCall}
        >
          <img src={callIcon} alt="" />
        </button>
        <button
          type="button"
          className={`graph-panel-fab ${!simDone ? "sim-locked" : ""}`}
          aria-label="View Simulation Journey"
          disabled={!simDone || !(simulationData && simulationData[selectedNodeId])}
          onClick={
            simDone && simulationData && simulationData[selectedNodeId]
              ? () => setJourneyModalOpen(true)
              : undefined
          }
          title={
            !simDone
              ? "Available after simulation completes"
              : simulationData && simulationData[selectedNodeId]
              ? "View Simulation Journey"
              : "No simulation data for this agent"
          }
        >
          <img src={notesIcon} alt="" />
        </button>
      </div>

      <div
        className={`graph-node-terminal ${isTerminalOpen ? "open" : ""}`}
        aria-hidden={!isTerminalOpen}
      >
        <div className="graph-node-terminal-scroll">
          <div className="graph-node-terminal-profile">
            <p className="graph-node-terminal-name">{selectedNode?.label || selectedNodeId}</p>
            <div className="graph-node-terminal-grid">
              {detailColumns.map((column, columnIndex) => (
                <div className="graph-node-terminal-column" key={`detail-column-${columnIndex}`}>
                  {column.map((detailRow, rowIndex) => (
                    <div
                      className="graph-node-terminal-row"
                      key={`detail-row-${detailRow.key}-${columnIndex}-${rowIndex}`}
                    >
                      <span className="graph-node-terminal-key">{detailRow.label}</span>
                      <span className="graph-node-terminal-value" title={detailRow.value}>
                        {detailRow.value}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {simDone && !(simulationData && simulationData[selectedNodeId]) ? (
              <p className="sim-no-data">No simulation data for this agent.</p>
            ) : null}
          </div>
        </div>
      </div>

      {journeyModalOpen && simulationData && simulationData[selectedNodeId] && (
        <div
          className="sim-journey-modal-overlay"
          onClick={() => setJourneyModalOpen(false)}
        >
          <div
            className="sim-journey-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sim-journey-modal-header">
              <span className="sim-journey-modal-title">
                {selectedNode?.label || selectedNodeId}
              </span>
              <button
                type="button"
                className="sim-journey-modal-close"
                onClick={() => setJourneyModalOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="sim-journey-modal-scroll">
              <SimulationJourney data={simulationData[selectedNodeId]} />
            </div>
          </div>
        </div>
      )}

      {callCardOpen && activeCallAgentId && (
        <div className="graph-call-card" role="dialog" aria-label="Agent call card">
          <div className="graph-call-card-header">
            <span className="graph-call-card-name">
              {nodeById.get(activeCallAgentId)?.label || activeCallAgentId}
            </span>
            <button
              type="button"
              className="graph-call-card-close"
              onClick={disconnectCall}
              aria-label="End call"
            >
              ✕
            </button>
          </div>
          <div className="graph-call-card-media">
            {useVideoFeed ? (
              <div ref={videoHostRef} className="graph-call-card-video-host" />
            ) : (
              !portraitFailed ? (
                <img
                  src={activePortraitSrc}
                  alt={nodeById.get(activeCallAgentId)?.label || activeCallAgentId}
                  className="graph-call-card-photo"
                  onError={() => setPortraitFailed(true)}
                />
              ) : null
            )}
            {!useVideoFeed && portraitFailed ? (
              <div className="graph-call-card-photo-fallback">
                {nodeById.get(activeCallAgentId)?.label || activeCallAgentId}
              </div>
            ) : null}
          </div>
          <p className="graph-call-card-status">{callStatus}</p>
          {callError ? <p className="graph-call-card-error">{callError}</p> : null}
          <div ref={audioHostRef} className="graph-call-card-audio-host" />
        </div>
      )}
    </div>
  );
}

export default GraphCirclePanel;
