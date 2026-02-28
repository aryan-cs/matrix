import { useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

const AGENTS_ENDPOINT = "/api/avatar/agents";
const START_ENDPOINT = "/api/avatar/session/start";
const TURN_ENDPOINT = "/api/avatar/turn";

function AgentLiveAvatarCard() {
  const [agents, setAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [activeSession, setActiveSession] = useState(null);
  const [userText, setUserText] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [isSendingTurn, setIsSendingTurn] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const roomRef = useRef(null);
  const mediaRef = useRef(null);
  const audioRef = useRef(null);

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

  const toggleMicrophone = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micEnabled;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicEnabled(next);
      setStatus(next ? "Microphone enabled" : "Microphone muted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update microphone state.");
    }
  };

  const toggleCamera = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !camEnabled;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCamEnabled(next);
      setStatus(next ? "Camera enabled" : "Camera disabled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update camera state.");
    }
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
      // Publish local media so the avatar agent can hear/see the user.
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        setMicEnabled(true);
      } catch {
        setMicEnabled(false);
      }
      try {
        await room.localParticipant.setCameraEnabled(true);
        setCamEnabled(true);
      } catch {
        setCamEnabled(false);
      }
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (publication.isSubscribed && publication.track) {
            attachTrack(publication.track);
          }
        });
      });
      roomRef.current = room;
      setStatus(`Connected for ${selectedAgentId}. If prompted, allow mic/camera access.`);
    } catch (err) {
      disconnect();
      setError(err instanceof Error ? err.message : "Could not start avatar session.");
      setStatus("Start failed");
    } finally {
      setIsStarting(false);
    }
  };

  const sendTurn = async () => {
    const text = userText.trim();
    if (!selectedAgentId) {
      setError("Pick an agent first.");
      return;
    }
    if (!text) {
      setError("Enter text to send.");
      return;
    }

    setIsSendingTurn(true);
    setError("");
    setStatus("Thinking and synthesizing speech...");
    try {
      const response = await fetch(TURN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: selectedAgentId, user_text: text })
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Turn failed (${response.status}): ${detail}`);
      }
      const data = await response.json();
      setAssistantText(data.assistant_text || "");

      const audio = audioRef.current;
      if (audio && data.audio_base64) {
        audio.src = `data:${data.audio_mime_type || "audio/mpeg"};base64,${data.audio_base64}`;
        await audio.play();
      }
      setStatus("Assistant replied.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process turn.");
      setStatus("Turn failed");
    } finally {
      setIsSendingTurn(false);
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
        <button type="button" className="secondary" onClick={toggleMicrophone} disabled={!activeSession}>
          {micEnabled ? "Mute Mic" : "Unmute Mic"}
        </button>
        <button type="button" className="secondary" onClick={toggleCamera} disabled={!activeSession}>
          {camEnabled ? "Disable Cam" : "Enable Cam"}
        </button>
      </div>

      <div className="agent-avatar-turn-row">
        <input
          type="text"
          value={userText}
          onChange={(event) => setUserText(event.target.value)}
          placeholder="Say something to this agent..."
          disabled={isSendingTurn}
        />
        <button type="button" onClick={sendTurn} disabled={isSendingTurn || !selectedAgentId}>
          {isSendingTurn ? "Sending..." : "Send Turn"}
        </button>
      </div>

      <p className="agent-avatar-status">{status}</p>
      {error ? <p className="agent-avatar-error">{error}</p> : null}
      {assistantText ? <p className="agent-avatar-reply"><strong>Reply:</strong> {assistantText}</p> : null}

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
      <audio ref={audioRef} className="agent-avatar-audio" controls />
    </section>
  );
}

export default AgentLiveAvatarCard;
