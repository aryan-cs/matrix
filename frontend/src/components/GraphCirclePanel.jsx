import { useEffect, useMemo, useRef, useState } from "react";

function clampNodeRadius(count) {
  if (count <= 12) return 16;
  if (count <= 28) return 13;
  if (count <= 70) return 10.5;
  if (count <= 140) return 8.5;
  return 7;
}

function deriveNodeNumberText(id, fallbackIndex) {
  const rawId = String(id ?? "").trim();
  const lastNumericMatch = rawId.match(/(\d+)(?!.*\d)/);
  if (lastNumericMatch?.[1]) {
    return lastNumericMatch[1].slice(-3).padStart(3, "0");
  }
  return String(fallbackIndex + 1).padStart(3, "0");
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
    const sourceId = String(edge?.source ?? edge?.from ?? edge?.src ?? "");
    const targetId = String(edge?.target ?? edge?.to ?? edge?.dst ?? "");
    if (!indexById.has(sourceId) || !indexById.has(targetId)) continue;
    pushEdge(indexById.get(sourceId), indexById.get(targetId));
  }

  return { nodes, edges };
}

function buildHomePositions(count, width, height, nodeRadius) {
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  if (count <= 0) {
    return { positions: [], centerX, centerY, ringRadius: 0 };
  }

  const ringRadius = Math.max(40, Math.min(width, height) * 0.42 - nodeRadius - 8);
  const positions = [];
  for (let i = 0; i < count; i += 1) {
    const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
    positions.push({
      x: centerX + Math.cos(angle) * ringRadius,
      y: centerY + Math.sin(angle) * ringRadius
    });
  }

  return { positions, centerX, centerY, ringRadius };
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

function buildDetailRows(selectedNode, nodeById, adjacencyById) {
  if (!selectedNode) return [];

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

  const rows = [
    { label: "__name__", value: selectedNode.label || selectedNode.id },
    { label: "Agent ID", value: selectedNode.id }
  ];

  const metadata = selectedNode.metadata && typeof selectedNode.metadata === "object"
    ? selectedNode.metadata
    : {};

  for (const [key, label] of DETAIL_FIELDS) {
    const value = String(metadata[key] ?? "").trim();
    if (!value) continue;
    rows.push({ label, value });
  }

  rows.push({ label: "Connected Nodes", value: connectionNames.join(", ") });
  return rows;
}

function GraphCirclePanel({ graph = null }) {
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const selectedNodeIdRef = useRef("");
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const graphData = useMemo(
    () => normalizeGraphData(graph),
    [graph]
  );
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
  const detailTargetRows = useMemo(() => {
    const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : null;
    return buildDetailRows(selectedNode, nodeById, adjacencyById);
  }, [selectedNodeId, nodeById, adjacencyById]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    if (selectedNodeId && !nodeById.has(selectedNodeId)) {
      setSelectedNodeId("");
    }
  }, [selectedNodeId, nodeById]);

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
      ringRadius: 0,
      nodes: [],
      edges: [],
      activeNodeIndex: -1,
      pointerDownNodeIndex: -1,
      pointerDownX: 0,
      pointerDownY: 0,
      didDragSincePointerDown: false,
      rafId: 0
    };
    let resizeRafId = 0;

    const setCanvasViewport = (width, height) => {
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      const viewportChanged =
        engine.width !== width ||
        engine.height !== height ||
        engine.dpr !== dpr;

      if (!viewportChanged) {
        return;
      }

      engine.width = width;
      engine.height = height;
      engine.dpr = dpr;

      canvasNode.width = Math.round(width * dpr);
      canvasNode.height = Math.round(height * dpr);
      canvasNode.style.width = `${width}px`;
      canvasNode.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const rebuildEdges = () => {
      engine.edges = graphData.edges
        .filter(
          (edge) =>
            Number.isInteger(edge.sourceIndex) &&
            Number.isInteger(edge.targetIndex) &&
            edge.sourceIndex >= 0 &&
            edge.targetIndex >= 0 &&
            edge.sourceIndex < engine.nodes.length &&
            edge.targetIndex < engine.nodes.length &&
            edge.sourceIndex !== edge.targetIndex
        )
        .map((edge) => {
          const source = engine.nodes[edge.sourceIndex];
          const target = engine.nodes[edge.targetIndex];
          const restLength = Math.max(
            source.radius * 5,
            Math.hypot(target.homeX - source.homeX, target.homeY - source.homeY)
          );
          return {
            sourceIndex: edge.sourceIndex,
            targetIndex: edge.targetIndex,
            restLength
          };
        });
    };

    const setupFromGraph = ({ preservePositions }) => {
      const width = Math.max(1, stageNode.clientWidth);
      const height = Math.max(1, stageNode.clientHeight);
      if (width < 40 || height < 40) {
        return;
      }

      const previousWidth = engine.width;
      const previousHeight = engine.height;
      setCanvasViewport(width, height);
      const nodeRadius = clampNodeRadius(graphData.nodes.length);
      const layout = buildHomePositions(graphData.nodes.length, width, height, nodeRadius);
      const homes = layout.positions;
      engine.centerX = layout.centerX;
      engine.centerY = layout.centerY;
      engine.ringRadius = layout.ringRadius;
      const shouldRebuildNodes =
        !preservePositions || engine.nodes.length !== homes.length;

      if (shouldRebuildNodes) {
        engine.nodes = homes.map((home, index) => ({
          id: graphData.nodes[index].id,
          numberText: deriveNodeNumberText(graphData.nodes[index].id, index),
          x: home.x,
          y: home.y,
          homeX: home.x,
          homeY: home.y,
          vx: 0,
          vy: 0,
          radius: nodeRadius
        }));
        engine.activeNodeIndex = -1;
      } else {
        const scaleX = previousWidth > 0 ? width / previousWidth : 1;
        const scaleY = previousHeight > 0 ? height / previousHeight : 1;

        for (let i = 0; i < engine.nodes.length; i += 1) {
          const node = engine.nodes[i];
          const home = homes[i];
          node.homeX = home.x;
          node.homeY = home.y;
          node.radius = nodeRadius;
          node.x *= scaleX;
          node.y *= scaleY;
          node.vx *= 0.82;
          node.vy *= 0.82;
        }
      }

      rebuildEdges();
    };

    const pointerPositionFor = (event) => {
      const bounds = canvasNode.getBoundingClientRect();
      return {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      };
    };

    const findClosestNodeIndex = (x, y) => {
      let bestIndex = -1;
      let bestDistanceSq = Number.POSITIVE_INFINITY;
      for (let i = 0; i < engine.nodes.length; i += 1) {
        const node = engine.nodes[i];
        const dx = x - node.x;
        const dy = y - node.y;
        const distanceSq = dx * dx + dy * dy;
        const maxGrab = (node.radius + 8) * (node.radius + 8);
        if (distanceSq > maxGrab || distanceSq >= bestDistanceSq) continue;
        bestDistanceSq = distanceSq;
        bestIndex = i;
      }
      return bestIndex;
    };

    const clampToStage = (node) => {
      const minX = node.radius + 6;
      const maxX = engine.width - node.radius - 6;
      const minY = node.radius + 6;
      const maxY = engine.height - node.radius - 6;
      node.x = Math.max(minX, Math.min(maxX, node.x));
      node.y = Math.max(minY, Math.min(maxY, node.y));
    };

    const onPointerDown = (event) => {
      const pointer = pointerPositionFor(event);
      const closestIndex = findClosestNodeIndex(pointer.x, pointer.y);
      engine.pointerDownNodeIndex = closestIndex;
      engine.pointerDownX = pointer.x;
      engine.pointerDownY = pointer.y;
      engine.didDragSincePointerDown = false;
      if (closestIndex === -1) {
        setSelectedNodeId("");
        return;
      }
      engine.activeNodeIndex = closestIndex;
      const activeNode = engine.nodes[closestIndex];
      activeNode.x = pointer.x;
      activeNode.y = pointer.y;
      activeNode.vx = 0;
      activeNode.vy = 0;
      canvasNode.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event) => {
      if (engine.activeNodeIndex === -1) return;
      const pointer = pointerPositionFor(event);
      const movedDistanceSq =
        (pointer.x - engine.pointerDownX) * (pointer.x - engine.pointerDownX) +
        (pointer.y - engine.pointerDownY) * (pointer.y - engine.pointerDownY);
      if (movedDistanceSq > 16) {
        engine.didDragSincePointerDown = true;
      }
      const activeNode = engine.nodes[engine.activeNodeIndex];
      if (!activeNode) return;
      activeNode.x = pointer.x;
      activeNode.y = pointer.y;
      activeNode.vx = 0;
      activeNode.vy = 0;
      clampToStage(activeNode);
    };

    const releaseActiveNode = (event) => {
      if (engine.activeNodeIndex === -1) return;
      const releasedNodeIndex = engine.activeNodeIndex;
      if (canvasNode.hasPointerCapture(event.pointerId)) {
        canvasNode.releasePointerCapture(event.pointerId);
      }
      engine.activeNodeIndex = -1;
      const wasClickSelection =
        !engine.didDragSincePointerDown &&
        engine.pointerDownNodeIndex === releasedNodeIndex &&
        releasedNodeIndex >= 0;
      engine.pointerDownNodeIndex = -1;
      engine.didDragSincePointerDown = false;
      if (wasClickSelection) {
        const node = engine.nodes[releasedNodeIndex];
        if (node?.id) {
          setSelectedNodeId(node.id);
        }
      }
    };

    const step = () => {
      const nodes = engine.nodes;
      if (nodes.length === 0) return;

      const activeIndex = engine.activeNodeIndex;
      const forces = nodes.map(() => ({ x: 0, y: 0 }));

      const springK = 0.028;
      const damping = 0.86;
      const edgeK = 0;
      const repulsionStrength = 0;
      const repulsionRadius = 92;
      const repulsionRadiusSq = repulsionRadius * repulsionRadius;

      for (let i = 0; i < nodes.length; i += 1) {
        if (i === activeIndex) continue;
        const node = nodes[i];
        forces[i].x += (node.homeX - node.x) * springK;
        forces[i].y += (node.homeY - node.y) * springK;
      }

      for (const edge of engine.edges) {
        const source = nodes[edge.sourceIndex];
        const target = nodes[edge.targetIndex];
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const unitX = dx / dist;
        const unitY = dy / dist;
        const forceMagnitude = (dist - edge.restLength) * edgeK;
        const fx = unitX * forceMagnitude;
        const fy = unitY * forceMagnitude;

        if (edge.sourceIndex !== activeIndex) {
          forces[edge.sourceIndex].x += fx;
          forces[edge.sourceIndex].y += fy;
        }
        if (edge.targetIndex !== activeIndex) {
          forces[edge.targetIndex].x -= fx;
          forces[edge.targetIndex].y -= fy;
        }
      }

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const left = nodes[i];
          const right = nodes[j];
          const dx = right.x - left.x;
          const dy = right.y - left.y;
          const distanceSq = dx * dx + dy * dy + 0.001;
          if (distanceSq > repulsionRadiusSq) continue;
          const distance = Math.sqrt(distanceSq);
          const unitX = dx / distance;
          const unitY = dy / distance;
          const forceMagnitude = repulsionStrength / distanceSq;
          const fx = unitX * forceMagnitude;
          const fy = unitY * forceMagnitude;
          if (i !== activeIndex) {
            forces[i].x -= fx;
            forces[i].y -= fy;
          }
          if (j !== activeIndex) {
            forces[j].x += fx;
            forces[j].y += fy;
          }
        }
      }

      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (i === activeIndex) {
          node.vx = 0;
          node.vy = 0;
          clampToStage(node);
          continue;
        }

        node.vx = (node.vx + forces[i].x) * damping;
        node.vy = (node.vy + forces[i].y) * damping;
        if (Math.abs(node.vx) < 0.0008) node.vx = 0;
        if (Math.abs(node.vy) < 0.0008) node.vy = 0;

        node.x += node.vx;
        node.y += node.vy;
        clampToStage(node);
      }
    };

    const draw = () => {
      context.clearRect(0, 0, engine.width, engine.height);

      if (engine.nodes.length === 0) return;

      context.beginPath();
      for (const edge of engine.edges) {
        const source = engine.nodes[edge.sourceIndex];
        const target = engine.nodes[edge.targetIndex];
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const chordLength = Math.hypot(dx, dy) || 0.0001;
        const midX = (source.x + target.x) * 0.5;
        const midY = (source.y + target.y) * 0.5;
        const toCenterX = engine.centerX - midX;
        const toCenterY = engine.centerY - midY;
        const normalX = -dy / chordLength;
        const normalY = dx / chordLength;
        const insidePull = 0.52;
        const swirlDirection = ((edge.sourceIndex + edge.targetIndex) & 1) === 0 ? 1 : -1;
        const swirlAmount = Math.min(14, chordLength * 0.09);
        const controlX = midX + toCenterX * insidePull + normalX * swirlAmount * swirlDirection;
        const controlY = midY + toCenterY * insidePull + normalY * swirlAmount * swirlDirection;

        context.moveTo(source.x, source.y);
        context.quadraticCurveTo(controlX, controlY, target.x, target.y);
      }
      context.strokeStyle = "rgba(255, 255, 255, 0.17)";
      context.lineWidth = 1;
      context.stroke();

      for (let i = 0; i < engine.nodes.length; i += 1) {
        const node = engine.nodes[i];
        const isActive = i === engine.activeNodeIndex;
        const isSelected = node.id === selectedNodeIdRef.current;
        context.beginPath();
        context.arc(node.x, node.y, node.radius + (isActive || isSelected ? 1.2 : 0), 0, Math.PI * 2);
        context.fillStyle = isActive || isSelected ? "rgba(255, 255, 255, 1)" : "rgba(255, 255, 255, 0.93)";
        context.fill();

        const fontSize = Math.max(8, Math.floor(node.radius * 0.9));
        context.font = `600 ${fontSize}px "Google Sans", sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "rgba(10, 10, 10, 0.95)";
        context.fillText(node.numberText || "000", node.x, node.y);
      }
    };

    const animate = () => {
      step();
      draw();
      engine.rafId = window.requestAnimationFrame(animate);
    };

    setupFromGraph({ preservePositions: false });
    const resizeObserver = new ResizeObserver(() => {
      if (resizeRafId) return;
      resizeRafId = window.requestAnimationFrame(() => {
        resizeRafId = 0;
        setupFromGraph({ preservePositions: true });
      });
    });
    resizeObserver.observe(stageNode);

    canvasNode.addEventListener("pointerdown", onPointerDown);
    canvasNode.addEventListener("pointermove", onPointerMove);
    canvasNode.addEventListener("pointerup", releaseActiveNode);
    canvasNode.addEventListener("pointercancel", releaseActiveNode);
    canvasNode.addEventListener("pointerleave", releaseActiveNode);

    animate();

    return () => {
      resizeObserver.disconnect();
      canvasNode.removeEventListener("pointerdown", onPointerDown);
      canvasNode.removeEventListener("pointermove", onPointerMove);
      canvasNode.removeEventListener("pointerup", releaseActiveNode);
      canvasNode.removeEventListener("pointercancel", releaseActiveNode);
      canvasNode.removeEventListener("pointerleave", releaseActiveNode);
      window.cancelAnimationFrame(engine.rafId);
      if (resizeRafId) {
        window.cancelAnimationFrame(resizeRafId);
      }
    };
  }, [graphData]);

  const resolvedCount = graphData.nodes.length;

  return (
    <div className="graph-circle-canvas">
      <div className="graph-circle-stage" ref={stageRef}>
        {resolvedCount === 0 ? (
          <p className="graph-circle-empty">No valid network graph data found in generated CSV.</p>
        ) : null}
        <canvas ref={canvasRef} className="graph-circle-canvas-element" />
      </div>
      {selectedNodeId ? (
        <div className="graph-node-inspector active">
          <dl className="graph-node-inspector-grid">
            {detailTargetRows.map((row, index) =>
              row.label === "__name__" ? (
                <div className="graph-node-inspector-row name" key={`name-${index}`}>
                  <dd className="graph-node-inspector-name">{row.value}</dd>
                </div>
              ) : (
                <div className="graph-node-inspector-row" key={`${row.label}-${index}`}>
                  <dt className="graph-node-inspector-label">{row.label}</dt>
                  <dd className="graph-node-inspector-value">{row.value}</dd>
                </div>
              )
            )}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

export default GraphCirclePanel;
