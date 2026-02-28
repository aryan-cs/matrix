import { useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

const AGENTS_ENDPOINT = "/api/avatar/agents";
const START_ENDPOINT = "/api/avatar/session/start";

function AgentLiveAvatarCard() {
  const [agents, setAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [activeSession, setActiveSession] = useState(null);
  const roomRef = useRef(null);
  const mediaRef = useRef(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.agent_id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  const clearMedia = () => {
    const node = mediaRef.current;
    if (!node) return;
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  };

  const disconnect = () => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    clearMedia();
    setActiveSession(null);
    setStatus("Disconnected");
  };

  const attachTrack = (track) => {
    const node = mediaRef.current;
    if (!node) return;
    const element = track.attach();
    element.classList.add("agent-avatar-track");
    if (track.kind === Track.Kind.Audio) {
      element.controls = true;
    }
    node.appendChild(element);
  };

  const loadAgents = async () => {
    setIsLoadingAgents(true);
    setError("");
    try {
      const response = await fetch(AGENTS_ENDPOINT);
      if (!response.ok) {
        throw new Error(`Agent fetch failed (${response.status})`);
      }
      const data = await response.json();
      const nextAgents = Array.isArray(data?.agents) ? data.agents : [];
      setAgents(nextAgents);
      if (nextAgents.length > 0 && !selectedAgentId) {
        setSelectedAgentId(nextAgents[0].agent_id);
      }
      setStatus(`Loaded ${nextAgents.length} mapped agents.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mapped agents.");
      setStatus("Failed to load agents");
    } finally {
      setIsLoadingAgents(false);
    }
  };

  const startSession = async () => {
    if (!selectedAgentId) {
      setError("Pick an agent first.");
      return;
    }
    setIsStarting(true);
    setError("");
    setStatus(`Starting avatar for ${selectedAgentId}...`);
    disconnect();

    try {
      const response = await fetch(START_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: selectedAgentId })
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Session start failed (${response.status}): ${detail}`);
      }
      const started = await response.json();
      setActiveSession(started);

      const room = new Room({ adaptiveStream: true, dynacast: true });
      room.on(RoomEvent.TrackSubscribed, (track) => attachTrack(track));
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
      });
      room.on(RoomEvent.ConnectionStateChanged, (state) => {
        setStatus(`LiveKit state: ${state}`);
      });
      room.on(RoomEvent.Disconnected, () => setStatus("Disconnected"));

      await room.connect(started.livekit_url, started.livekit_client_token);
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (publication.isSubscribed && publication.track) {
            attachTrack(publication.track);
          }
        });
      });
      roomRef.current = room;
      setStatus(`Connected for ${selectedAgentId}`);
    } catch (err) {
      disconnect();
      setError(err instanceof Error ? err.message : "Could not start avatar session.");
      setStatus("Start failed");
    } finally {
      setIsStarting(false);
    }
  };

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    return () => disconnect();
  }, []);

  return (
    <section className="agent-avatar-card">
      <h2>Agent Live Avatar</h2>
      <p className="agent-avatar-caption">
        Pick an agent profile. Backend will use `agents.csv` + `agent_to_avatar.json` and start HeyGen.
      </p>

      <div className="agent-avatar-controls">
        <select
          value={selectedAgentId}
          onChange={(event) => setSelectedAgentId(event.target.value)}
          disabled={isLoadingAgents || isStarting || agents.length === 0}
        >
          {agents.map((agent) => (
            <option key={agent.agent_id} value={agent.agent_id}>
              {agent.agent_id} - {agent.full_name} ({agent.avatar_name})
            </option>
          ))}
        </select>
        <button type="button" onClick={startSession} disabled={isStarting || !selectedAgentId}>
          {isStarting ? "Starting..." : "Start Avatar"}
        </button>
        <button type="button" className="secondary" onClick={disconnect}>
          Disconnect
        </button>
      </div>

      <p className="agent-avatar-status">{status}</p>
      {error ? <p className="agent-avatar-error">{error}</p> : null}

      {selectedAgent ? (
        <div className="agent-avatar-meta">
          <p>
            <strong>Avatar:</strong> {selectedAgent.avatar_name} ({selectedAgent.avatar_id})
          </p>
          <p>
            <strong>Voice:</strong> {selectedAgent.default_voice_name}
          </p>
        </div>
      ) : null}

      {activeSession?.system_prompt ? (
        <details className="agent-avatar-context">
          <summary>Agent Context (from agents.csv system_prompt)</summary>
          <pre>{activeSession.system_prompt}</pre>
        </details>
      ) : null}

      <div ref={mediaRef} className="agent-avatar-media" />
    </section>
  );
}

export default AgentLiveAvatarCard;
