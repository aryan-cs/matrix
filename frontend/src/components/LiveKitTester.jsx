import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

function extractCredential(jsonText) {
  if (!jsonText.trim()) return null;
  try {
    const parsed = JSON.parse(jsonText);
    const data = parsed?.data ?? parsed;
    if (typeof data?.livekit_url === "string" && typeof data?.livekit_client_token === "string") {
      return {
        url: data.livekit_url,
        token: data.livekit_client_token
      };
    }
    return null;
  } catch {
    return null;
  }
}

function LiveKitTester() {
  const [livekitUrl, setLivekitUrl] = useState("");
  const [livekitToken, setLivekitToken] = useState("");
  const [sessionJson, setSessionJson] = useState("");
  const [status, setStatus] = useState("Disconnected");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const roomRef = useRef(null);
  const mediaContainerRef = useRef(null);

  const clearMedia = () => {
    const container = mediaContainerRef.current;
    if (!container) return;
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  };

  const disconnect = () => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    setConnected(false);
    setStatus("Disconnected");
    clearMedia();
  };

  const attachTrack = (track) => {
    const container = mediaContainerRef.current;
    if (!container) return;
    const element = track.attach();
    element.classList.add("lk-track-element");
    if (track.kind === Track.Kind.Audio) {
      element.controls = true;
    }
    container.appendChild(element);
  };

  const handleConnect = async () => {
    if (!livekitUrl.trim() || !livekitToken.trim()) {
      setError("Enter both livekit_url and livekit_client_token.");
      return;
    }

    setError("");
    disconnect();
    setStatus("Connecting...");

    try {
      const room = new Room({
        adaptiveStream: true,
        dynacast: true
      });

      room.on(RoomEvent.Connected, () => {
        setConnected(true);
        setStatus(`Connected to room: ${room.name}`);
      });

      room.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setStatus("Disconnected");
      });

      room.on(RoomEvent.TrackSubscribed, (track) => {
        attachTrack(track);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
      });

      room.on(RoomEvent.ConnectionStateChanged, (state) => {
        setStatus(`Connection state: ${state}`);
      });

      await room.connect(livekitUrl.trim(), livekitToken.trim());

      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (publication.isSubscribed && publication.track) {
            attachTrack(publication.track);
          }
        });
      });

      roomRef.current = room;
    } catch (connectError) {
      disconnect();
      setError(connectError instanceof Error ? connectError.message : "Failed to connect to LiveKit.");
      setStatus("Connection failed");
    }
  };

  const handleAutofill = () => {
    const credentials = extractCredential(sessionJson);
    if (!credentials) {
      setError("Could not parse livekit_url/livekit_client_token from JSON.");
      return;
    }
    setLivekitUrl(credentials.url);
    setLivekitToken(credentials.token);
    setError("");
  };

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  return (
    <section className="avatar-test-panel">
      <h2>Avatar LiveKit Test</h2>
      <p className="avatar-test-caption">Paste `livekit_url` and `livekit_client_token`, then connect.</p>

      <label className="avatar-test-label" htmlFor="livekit-url-input">
        LiveKit URL
      </label>
      <input
        id="livekit-url-input"
        className="avatar-test-input"
        type="text"
        placeholder="wss://...livekit.cloud"
        value={livekitUrl}
        onChange={(event) => setLivekitUrl(event.target.value)}
      />

      <label className="avatar-test-label" htmlFor="livekit-token-input">
        LiveKit Client Token
      </label>
      <textarea
        id="livekit-token-input"
        className="avatar-test-textarea"
        rows={3}
        placeholder="Paste livekit_client_token"
        value={livekitToken}
        onChange={(event) => setLivekitToken(event.target.value)}
      />

      <div className="avatar-test-actions">
        <button type="button" className="avatar-btn" onClick={handleConnect} disabled={connected}>
          Connect
        </button>
        <button type="button" className="avatar-btn secondary" onClick={disconnect} disabled={!connected}>
          Disconnect
        </button>
      </div>

      <label className="avatar-test-label" htmlFor="session-json-input">
        Optional: paste full `/sessions/start` JSON
      </label>
      <textarea
        id="session-json-input"
        className="avatar-test-textarea"
        rows={4}
        placeholder='{"data":{"livekit_url":"...","livekit_client_token":"..."}}'
        value={sessionJson}
        onChange={(event) => setSessionJson(event.target.value)}
      />
      <button type="button" className="avatar-btn secondary" onClick={handleAutofill}>
        Autofill from JSON
      </button>

      <p className="avatar-test-status">{status}</p>
      {error ? <p className="avatar-test-error">{error}</p> : null}

      <div ref={mediaContainerRef} className="avatar-media-container" />
    </section>
  );
}

export default LiveKitTester;
