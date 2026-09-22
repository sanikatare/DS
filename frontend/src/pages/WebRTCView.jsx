import { useState, useEffect, useRef } from "react";
import PageShell from "../components/layout/PageShell";
import { Server, Radio, ShieldCheck, Zap, ArrowRight, CheckCircle2, AlertCircle, RefreshCw, Activity, Share2 } from "lucide-react";
import "../styles.css";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

const WS_SIGNALING_BASE = (import.meta.env.VITE_TXN_API_URL || "http://localhost:8000").replace(/^http/, "ws") + "/ws/webrtc";

export default function WebRTCView() {
  const [roomId, setRoomId] = useState("ROOM-001");
  const [peerId, setPeerId] = useState("sender-peer");
  const [roomPeers, setRoomPeers] = useState([]);
  
  const [signalingStatus, setSignalingStatus] = useState("DISCONNECTED");
  const [signalingState, setSignalingState] = useState("closed");
  const [iceGatheringState, setIceGatheringState] = useState("new");
  const [iceConnectionState, setIceConnectionState] = useState("new");
  const [connectionState, setConnectionState] = useState("new");
  const [dataChannelState, setDataChannelState] = useState("closed");

  const [senderId, setSenderId] = useState("sanika@bank");
  const [receiverId, setReceiverId] = useState("navya@bank");
  const [amount, setAmount] = useState(500);

  const [logs, setLogs] = useState([]);
  const [telemetry, setTelemetry] = useState({
    sentMsgs: 0,
    recvMsgs: 0,
    sentBytes: 0,
    recvBytes: 0,
    rttMs: null
  });

  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const sendTimeRef = useRef(null);

  const addLog = (tag, message, payload = null) => {
    setLogs((prev) => [
      {
        time: new Date().toLocaleTimeString(),
        tag,
        message,
        payload,
      },
      ...prev.slice(0, 49)
    ]);
  };

  const setupDataChannelEvents = (dc) => {
    dcRef.current = dc;
    dc.onopen = () => {
      setDataChannelState("open");
      addLog("DATACHANNEL", "RTCDataChannel 'upi-p2p' is OPEN and ready for direct peer transmission.");
    };

    dc.onclose = () => {
      setDataChannelState("closed");
      addLog("DATACHANNEL", "RTCDataChannel 'upi-p2p' has been CLOSED.");
    };

    dc.onerror = (err) => {
      addLog("ERROR", `RTCDataChannel error: ${err.message || err}`);
    };

    dc.onmessage = (event) => {
      try {
        const text = event.data;
        const bytes = new Blob([text]).size;
        const data = JSON.parse(text);
        
        setTelemetry((prev) => ({
          ...prev,
          recvMsgs: prev.recvMsgs + 1,
          recvBytes: prev.recvBytes + bytes
        }));

        if (data.type === "transaction") {
          addLog("RX (DATACHANNEL)", `Received Direct P2P Transaction Payload: ${data.transactionId} (₹${data.amount})`, data);
          
          // Reply with ACK over the same DataChannel
          const ackMsg = {
            type: "transaction-ack",
            transactionId: data.transactionId,
            status: "RECEIVED",
            timestamp: new Date().toISOString(),
            protocol: "webrtc"
          };
          const ackText = JSON.stringify(ackMsg);
          dc.send(ackText);
          
          const ackBytes = new Blob([ackText]).size;
          setTelemetry((prev) => ({
            ...prev,
            sentMsgs: prev.sentMsgs + 1,
            sentBytes: prev.sentBytes + ackBytes
          }));
          addLog("TX (DATACHANNEL)", `Sent Transaction ACK over RTCDataChannel for ${data.transactionId}`, ackMsg);
        } else if (data.type === "transaction-ack") {
          const rtt = sendTimeRef.current ? Math.round(performance.now() - sendTimeRef.current) : null;
          addLog("RX (DATACHANNEL)", `Received Transaction ACK for ${data.transactionId} (RTT: ${rtt !== null ? rtt + "ms" : "N/A"})`, data);
          setTelemetry((prev) => ({ ...prev, rttMs: rtt }));
        } else {
          addLog("RX (DATACHANNEL)", `Received DataChannel Message`, data);
        }
      } catch {
        addLog("RX (DATACHANNEL)", `Received raw text: ${event.data}`);
      }
    };
  };

  const initPeerConnection = () => {
    if (pcRef.current) {
      pcRef.current.close();
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    setSignalingState(pc.signalingState);
    setIceGatheringState(pc.iceGatheringState);
    setIceConnectionState(pc.iceConnectionState);
    setConnectionState(pc.connectionState);

    pc.onsignalingstatechange = () => setSignalingState(pc.signalingState);
    pc.onicegatheringstatechange = () => setIceGatheringState(pc.iceGatheringState);
    
    pc.oniceconnectionstatechange = () => {
      setIceConnectionState(pc.iceConnectionState);
      addLog("ICE", `ICE Connection State -> ${pc.iceConnectionState.toUpperCase()}`);
    };

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      addLog("WEBRTC", `Peer Connection State -> ${pc.connectionState.toUpperCase()}`);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "ice-candidate",
          roomId,
          peerId,
          candidate: event.candidate
        }));
        addLog("SIGNALING (TX)", "Dispatched ICE candidate to signaling server");
      }
    };

    pc.ondatachannel = (event) => {
      addLog("WEBRTC", `Received remote DataChannel '${event.channel.label}'`);
      setupDataChannelEvents(event.channel);
    };

    return pc;
  };

  const handleJoinSignaling = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    setSignalingStatus("CONNECTING");
    addLog("SIGNALING", `Connecting to signaling server at /ws/webrtc (Room: ${roomId}, Peer: ${peerId})...`);

    const wsUrl = `${WS_SIGNALING_BASE}?roomId=${encodeURIComponent(roomId)}&peerId=${encodeURIComponent(peerId)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setSignalingStatus("CONNECTED");
      addLog("SIGNALING", "WebSocket signaling channel connected.");
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        addLog("SIGNALING (RX)", `Received '${msg.type}' signaling message`, msg);

        if (msg.type === "joined") {
          setRoomPeers(msg.peers || []);
          addLog("SIGNALING", `Room '${msg.roomId}' members: ${msg.peers.join(", ")}`);
        } else if (msg.type === "peer-joined") {
          setRoomPeers(msg.peers || []);
          addLog("SIGNALING", `Peer '${msg.peerId}' joined room.`);
        } else if (msg.type === "peer-left") {
          setRoomPeers(msg.peers || []);
          addLog("SIGNALING", `Peer '${msg.peerId}' left room.`);
        } else if (msg.type === "offer") {
          const pc = initPeerConnection();
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          addLog("WEBRTC", "Remote SDP offer set. Creating answer...");
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          addLog("WEBRTC", "Local SDP answer created & set. Sending to signaling server...");
          ws.send(JSON.stringify({
            type: "answer",
            roomId,
            peerId,
            sdp: answer
          }));
        } else if (msg.type === "answer") {
          if (pcRef.current) {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            addLog("WEBRTC", "Remote SDP answer set. WebRTC handshake completed.");
          }
        } else if (msg.type === "ice-candidate" || msg.type === "candidate") {
          if (pcRef.current && msg.candidate) {
            try {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
              addLog("ICE", "Added remote ICE candidate.");
            } catch (err) {
              addLog("ERROR", `Failed to add remote ICE candidate: ${err.message}`);
            }
          }
        } else if (msg.type === "error") {
          addLog("ERROR", `Signaling Server Error: ${msg.message}`);
        }
      } catch (err) {
        addLog("ERROR", `Signaling parsing error: ${err.message}`);
      }
    };

    ws.onclose = () => {
      setSignalingStatus("DISCONNECTED");
      addLog("SIGNALING", "WebSocket signaling channel disconnected.");
    };

    ws.onerror = () => {
      setSignalingStatus("FAILED");
      addLog("ERROR", "WebSocket signaling channel error.");
    };
  };

  const handleCreateOffer = async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog("ERROR", "Must join signaling room before creating offer.");
      return;
    }

    addLog("WEBRTC", "Initiating WebRTC offer. Creating RTCPeerConnection & DataChannel 'upi-p2p'...");
    const pc = initPeerConnection();

    // Create DataChannel
    const dc = pc.createDataChannel("upi-p2p");
    setupDataChannelEvents(dc);

    // Create Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    addLog("WEBRTC", "Local SDP offer created & set. Transmitting over WebSocket signaling...");

    wsRef.current.send(JSON.stringify({
      type: "offer",
      roomId,
      peerId,
      sdp: offer
    }));
  };

  const handleSendTransaction = () => {
    if (!dcRef.current || dcRef.current.readyState !== "open") {
      addLog("ERROR", "Cannot send transaction: RTCDataChannel is not OPEN!");
      return;
    }

    const payload = {
      type: "transaction",
      transactionId: `WEBRTC-TXN-${Date.now().toString(36).toUpperCase()}`,
      senderId,
      receiverId,
      amount: parseFloat(amount),
      timestamp: new Date().toISOString(),
      protocol: "webrtc"
    };

    const text = JSON.stringify(payload);
    sendTimeRef.current = performance.now();
    dcRef.current.send(text);

    const bytes = new Blob([text]).size;
    setTelemetry((prev) => ({
      ...prev,
      sentMsgs: prev.sentMsgs + 1,
      sentBytes: prev.sentBytes + bytes
    }));

    addLog("TX (DATACHANNEL)", `Transmitted transaction ${payload.transactionId} directly over RTCDataChannel (bypassing backend)`, payload);
  };

  const handleLeaveRoom = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (pcRef.current) {
      pcRef.current.close();
    }
    if (dcRef.current) {
      dcRef.current.close();
    }
    setSignalingStatus("DISCONNECTED");
    setDataChannelState("closed");
    setRoomPeers([]);
    addLog("SYSTEM", "Reset peer connection and left signaling room.");
  };

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (pcRef.current) pcRef.current.close();
    };
  }, []);

  return (
    <PageShell connStatus={signalingStatus === "CONNECTED" ? "connected" : "connecting"}>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">WEBRTC</h1>
          <p className="page-subtitle">Browser-to-browser P2P DataChannel</p>
        </div>
      </div>

      {/* Topology Distinction Banner */}
      <div className="ui-card" style={{ padding: "16px 20px", marginBottom: 20 }}>
        <div style={{ fontSize: "0.76rem", fontWeight: 800, color: "var(--orange-primary)", letterSpacing: "0.05em", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={16} />
          <span>SIGNALING PATH vs PEER DATA PATH</span>
        </div>
        <div className="ui-grid-2">
          <div style={{ background: "rgba(230, 81, 0, 0.05)", padding: 10, borderRadius: "8px", borderLeft: "3px solid var(--orange-primary)" }}>
            <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--orange-primary)", display: "block" }}>
              SIGNALING (BACKEND)
            </span>
            <div className="font-mono" style={{ fontSize: "0.74rem", marginTop: 4, color: "var(--graphite)" }}>
              Peer A ➔ WebSocket (/ws/webrtc) ➔ Hub :8000 ➔ Peer B
            </div>
          </div>

          <div style={{ background: "rgba(46, 125, 50, 0.05)", padding: 10, borderRadius: "8px", borderLeft: "3px solid var(--green-success)" }}>
            <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--green-success)", display: "block" }}>
              DIRECT DATA PATH (P2P)
            </span>
            <div className="font-mono" style={{ fontSize: "0.74rem", marginTop: 4, color: "var(--graphite)", fontWeight: 800 }}>
              Peer A <span style={{ color: "var(--green-success)" }}>&lt;=== RTCDataChannel ("upi-p2p") ===&gt;</span> Peer B
            </div>
          </div>
        </div>
      </div>

      {/* Control Panel: Signaling Room Configuration */}
      <div style={{ maxWidth: 1000, margin: "0 auto 24px", background: "#ffffff", border: "1.5px solid var(--border)", borderRadius: "14px", padding: 20 }}>
        <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "var(--graphite)", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <Radio size={16} color="var(--orange-primary)" />
          <span>SIGNALING SESSION & PEER CONFIGURATION</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
          <div>
            <label className="font-mono" style={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: 4 }}>
              ROOM ID:
            </label>
            <input
              type="text"
              className="spatial-input font-mono"
              style={{ fontSize: "0.8rem", padding: "8px 12px" }}
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
          </div>

          <div>
            <label className="font-mono" style={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: 4 }}>
              PEER ROLE / ID:
            </label>
            <select
              className="spatial-select font-mono"
              style={{ fontSize: "0.8rem", padding: "8px 12px", width: "100%" }}
              value={peerId}
              onChange={(e) => setPeerId(e.target.value)}
            >
              <option value="sender-peer">sender-peer (Peer A Initiator)</option>
              <option value="receiver-peer">receiver-peer (Peer B Responder)</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <button
              onClick={handleJoinSignaling}
              className="btn-trigger-signal"
              style={{ padding: "8px 14px", fontSize: "0.78rem" }}
              disabled={signalingStatus === "CONNECTED"}
            >
              JOIN ROOM
            </button>
            <button
              onClick={handleLeaveRoom}
              style={{ padding: "8px 14px", fontSize: "0.78rem", background: "var(--graphite-light)", border: "1px solid var(--border)", borderRadius: "8px", fontWeight: 700, cursor: "pointer" }}
            >
              LEAVE
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              onClick={handleCreateOffer}
              className="btn-trigger-signal"
              style={{ padding: "8px 14px", fontSize: "0.78rem", background: "var(--green-success)", width: "100%" }}
              disabled={signalingStatus !== "CONNECTED" || dataChannelState === "open"}
            >
              CONNECT P2P (OFFER)
            </button>
          </div>
        </div>

        {/* Live Peers in Room */}
        <div style={{ marginTop: 12, fontSize: "0.75rem", color: "var(--muted)", display: "flex", gap: 16 }}>
          <span>ACTIVE ROOM PEERS: <strong style={{ color: "var(--orange-primary)" }}>{roomPeers.length > 0 ? roomPeers.join(", ") : "None"}</strong></span>
          <span>STUN SERVER: <strong style={{ color: "var(--graphite)" }}>stun.l.google.com:19302</strong></span>
        </div>
      </div>

      {/* State Meters Grid */}
      <div style={{ maxWidth: 1000, margin: "0 auto 24px", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <div style={{ background: "#ffffff", padding: 12, borderRadius: "10px", border: "1px solid var(--border)", textAlign: "center" }}>
          <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--muted)" }}>SIGNALING</span>
          <div style={{ fontWeight: 800, fontSize: "0.85rem", marginTop: 4, color: signalingStatus === "CONNECTED" ? "var(--green-success)" : "var(--danger)" }}>
            {signalingStatus}
          </div>
        </div>

        <div style={{ background: "#ffffff", padding: 12, borderRadius: "10px", border: "1px solid var(--border)", textAlign: "center" }}>
          <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--muted)" }}>ICE GATHERING</span>
          <div style={{ fontWeight: 800, fontSize: "0.82rem", marginTop: 4, color: "var(--graphite)" }}>
            {iceGatheringState.toUpperCase()}
          </div>
        </div>

        <div style={{ background: "#ffffff", padding: 12, borderRadius: "10px", border: "1px solid var(--border)", textAlign: "center" }}>
          <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--muted)" }}>ICE CONNECTION</span>
          <div style={{ fontWeight: 800, fontSize: "0.82rem", marginTop: 4, color: iceConnectionState === "connected" ? "var(--green-success)" : "var(--graphite)" }}>
            {iceConnectionState.toUpperCase()}
          </div>
        </div>

        <div style={{ background: "#ffffff", padding: 12, borderRadius: "10px", border: "1px solid var(--border)", textAlign: "center" }}>
          <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--muted)" }}>PEER CONNECTION</span>
          <div style={{ fontWeight: 800, fontSize: "0.82rem", marginTop: 4, color: connectionState === "connected" ? "var(--green-success)" : "var(--graphite)" }}>
            {connectionState.toUpperCase()}
          </div>
        </div>

        <div style={{ background: "#ffffff", padding: 12, borderRadius: "10px", border: "1px solid var(--border)", textAlign: "center" }}>
          <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--muted)" }}>RTCDataChannel</span>
          <div style={{ fontWeight: 800, fontSize: "0.85rem", marginTop: 4, color: dataChannelState === "open" ? "var(--green-success)" : "var(--danger)" }}>
            {dataChannelState.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Transaction Generator over RTCDataChannel */}
      <div style={{ maxWidth: 1000, margin: "0 auto 24px", background: "#ffffff", border: "1.5px solid var(--border)", borderRadius: "14px", padding: 24 }}>
        <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "var(--graphite)", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={16} color="var(--orange-primary)" />
          <span>TRANSACTION SIMULATOR OVER RTCDataChannel</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 14, alignItems: "flex-end" }}>
          <div>
            <label className="font-mono" style={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: 4 }}>
              SENDER ID:
            </label>
            <input
              type="text"
              className="spatial-input font-mono"
              style={{ fontSize: "0.8rem", padding: "8px 12px" }}
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
            />
          </div>

          <div>
            <label className="font-mono" style={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: 4 }}>
              RECEIVER ID:
            </label>
            <input
              type="text"
              className="spatial-input font-mono"
              style={{ fontSize: "0.8rem", padding: "8px 12px" }}
              value={receiverId}
              onChange={(e) => setReceiverId(e.target.value)}
            />
          </div>

          <div>
            <label className="font-mono" style={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: 4 }}>
              AMOUNT (INR ₹):
            </label>
            <input
              type="number"
              className="spatial-input font-mono"
              style={{ fontSize: "0.8rem", padding: "8px 12px" }}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <button
            onClick={handleSendTransaction}
            className="btn-trigger-signal"
            style={{ padding: "10px 20px", fontSize: "0.82rem" }}
            disabled={dataChannelState !== "open"}
          >
            SEND VIA WEBRTC →
          </button>
        </div>
      </div>

      {/* Telemetry Stats Bar */}
      <div
        className="font-mono"
        style={{
          maxWidth: 1000,
          margin: "0 auto 24px",
          display: "flex",
          justifyContent: "space-between",
          padding: "14px 20px",
          background: "#1E293B",
          color: "#F8FAFC",
          borderRadius: "12px",
          fontSize: "0.8rem",
          fontWeight: 700,
        }}
      >
        <div>MESSAGES SENT: <span style={{ color: "#38BDF8" }}>{telemetry.sentMsgs}</span></div>
        <div>MESSAGES RECV: <span style={{ color: "#4ADE80" }}>{telemetry.recvMsgs}</span></div>
        <div>BYTES SENT: <span style={{ color: "#FACC15" }}>{telemetry.sentBytes} B</span></div>
        <div>BYTES RECV: <span style={{ color: "#F472B6" }}>{telemetry.recvBytes} B</span></div>
        <div>ROUND TRIP TIME (RTT): <span style={{ color: "#E2E8F0" }}>{telemetry.rttMs !== null ? telemetry.rttMs + " ms" : "N/A"}</span></div>
      </div>

      {/* Live DataChannel Event Trace Log */}
      <div style={{ maxWidth: 1000, margin: "0 auto", background: "#ffffff", border: "1.5px solid var(--graphite)", borderRadius: "16px", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "var(--graphite)" }}>
            LIVE WEBRTC & DATACHANNEL LOG
          </div>
          <button
            onClick={() => setLogs([])}
            style={{ padding: "4px 10px", fontSize: "0.72rem", background: "var(--graphite-light)", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer", fontWeight: 700 }}
          >
            CLEAR LOG
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 350, overflowY: "auto" }}>
          {logs.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: "0.82rem" }}>
              No WebRTC signaling or DataChannel events logged yet. Connect to signaling room to initiate P2P data flow.
            </div>
          ) : (
            logs.map((lg, idx) => (
              <div key={idx} className="font-mono" style={{ fontSize: "0.78rem", padding: "8px 12px", background: "rgba(44, 45, 47, 0.03)", borderRadius: "6px", borderLeft: lg.tag.includes("RX") ? "3px solid var(--green-success)" : lg.tag.includes("TX") ? "3px solid var(--orange-primary)" : "3px solid var(--graphite)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800 }}>
                  <span style={{ color: lg.tag.includes("RX") ? "var(--green-success)" : lg.tag.includes("TX") ? "var(--orange-primary)" : "var(--graphite)" }}>
                    [{lg.tag}] {lg.message}
                  </span>
                  <span style={{ color: "var(--muted)" }}>{lg.time}</span>
                </div>
                {lg.payload && lg.payload.type !== "offer" && lg.payload.type !== "answer" && lg.payload.type !== "ice-candidate" && (
                  <pre style={{ margin: "4px 0 0", fontSize: "0.72rem", color: "var(--graphite-secondary)", whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(lg.payload, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </PageShell>
  );
}
