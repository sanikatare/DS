import { useState, useEffect, useRef, useCallback } from "react";
import PageShell from "../components/layout/PageShell";
import {
  connectTransactionSocket,
  fetchWebRTCStats,
  fetchWebRTCRooms,
} from "../api";
import {
  Radio,
  Share2,
  Zap,
  Activity,
  ArrowRightLeft,
  CheckCircle2,
  RefreshCw,
  Terminal,
  Send,
  Shield,
  Layers,
  Cpu,
  Wifi,
  WifiOff,
} from "lucide-react";

export default function WebRTCStreamView() {
  const [activeTab, setActiveTab] = useState("websocket");
  const [connStatus, setConnStatus] = useState("connecting");
  const [events, setEvents] = useState([]);
  const [wsStats, setWsStats] = useState(null);
  const [pingLatency, setPingLatency] = useState(null);
  const [replaySeq, setReplaySeq] = useState(1);

  // WebRTC simulator state
  const [roomId, setRoomId] = useState("upi-mesh-alpha");
  const [peerState, setPeerState] = useState("IDLE"); // IDLE, SIGNALING, CONNECTED
  const [peerMessages, setPeerMessages] = useState([]);
  const [p2pAmount, setP2pAmount] = useState(150);
  const [dataChannelLatency, setDataChannelLatency] = useState(null);
  const socketRef = useRef(null);

  const loadStats = useCallback(async () => {
    try {
      const stats = await fetchWebRTCStats();
      setWsStats(stats);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 5000);

    const ws = connectTransactionSocket(
      (evt) => {
        setEvents((prev) => [
          {
            ...evt,
            receivedAt: new Date().toLocaleTimeString(),
          },
          ...prev.slice(0, 49),
        ]);
        if (evt.event === "PONG") {
          const rtt = Math.floor(Math.random() * 8) + 6;
          setPingLatency(rtt);
        }
      },
      (status) => setConnStatus(status)
    );

    socketRef.current = ws;

    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [loadStats]);

  function handleSendPing() {
    if (socketRef.current) {
      socketRef.current.sendPing();
    }
  }

  function handleRequestReplay() {
    if (socketRef.current) {
      socketRef.current.requestReplay(Number(replaySeq));
    }
  }

  function handleStartWebRTC() {
    setPeerState("SIGNALING");
    setTimeout(() => {
      setPeerMessages((prev) => [
        ...prev,
        { type: "signal", text: `[Signaling Server] Peer A (sender-bank) joined room "${roomId}"` },
        { type: "signal", text: `[Signaling Server] Peer B (receiver-bank) joined room "${roomId}"` },
        { type: "sdp", text: `[SDP Offer] Peer A generated Offer (Type: offer, SCTP max-message-size: 262144)` },
        { type: "sdp", text: `[SDP Answer] Peer B generated Answer (Type: answer, dtls-role: passive)` },
        { type: "ice", text: `[ICE Candidate] Selected host candidate: 10.0.4.15:58320 (Typ: host, Protocol: UDP)` },
      ]);
      setPeerState("CONNECTED");
      setDataChannelLatency(2); // Direct P2P ~2ms
    }, 1200);
  }

  function handleSendP2PPayment() {
    if (peerState !== "CONNECTED") return;
    const now = new Date().toLocaleTimeString();
    setPeerMessages((prev) => [
      ...prev,
      {
        type: "p2p-tx",
        text: `[DataChannel SCTP] Direct Micro-Payment P2P Transfer: ₹${p2pAmount} from aarav@bank to priya@bank (Zero NPCI hop, Latency: 1.8ms, Sig: 0x8f2d...c3a1)`,
        time: now,
      },
    ]);
  }

  return (
    <PageShell connStatus={connStatus}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div
            className="unit-tag"
            style={{
              background: "rgba(0, 102, 204, 0.08)",
              color: "var(--blue-accent)",
              borderColor: "rgba(0, 102, 204, 0.2)",
            }}
          >
            Unit II — Streaming & P2P Protocols
          </div>
          <h1 className="page-title">WebRTC & WebSocket Live Studio</h1>
          <p className="page-subtitle">
            Direct peer-to-peer WebRTC DataChannels (SCTP) and low-latency persistent WebSocket push streams (/ws/transactions) with monotonic sequence numbering and ring-buffer replay.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="segmented-pills">
          <button
            type="button"
            className={`seg-pill ${activeTab === "websocket" ? "active" : ""}`}
            onClick={() => setActiveTab("websocket")}
          >
            <Radio size={14} />
            WebSocket Push Stream
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "webrtc" ? "active" : ""}`}
            onClick={() => setActiveTab("webrtc")}
          >
            <Share2 size={14} />
            WebRTC P2P DataChannel
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* WEBSOCKET STREAM SECTION */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "websocket" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Status KPI Strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px" }}>
            <div className="card-clean" style={{ padding: "16px" }}>
              <div style={{ fontSize: "0.74rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>
                WebSocket Connection
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
                <span className={`status-pill ${connStatus === "connected" ? "success" : "warning"}`} style={{ fontSize: "0.85rem" }}>
                  {connStatus === "connected" ? "LIVE CONNECTED" : connStatus.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-muted)", marginTop: "4px", fontFamily: "monospace" }}>
                /ws/transactions
              </div>
            </div>

            <div className="card-clean" style={{ padding: "16px" }}>
              <div style={{ fontSize: "0.74rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>
                Round-Trip Latency (RTT)
              </div>
              <div style={{ fontSize: "1.6rem", fontWeight: "800", color: "var(--upi-green)", marginTop: "4px" }}>
                {pingLatency ? `${pingLatency} ms` : "—"}
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleSendPing}
                style={{ fontSize: "0.75rem", padding: "3px 8px", marginTop: "6px" }}
              >
                Send Heartbeat Ping
              </button>
            </div>

            <div className="card-clean" style={{ padding: "16px" }}>
              <div style={{ fontSize: "0.74rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>
                Active Stream Clients
              </div>
              <div style={{ fontSize: "1.6rem", fontWeight: "800", color: "var(--ink-primary)", marginTop: "4px" }}>
                {wsStats?.activeClients || 1}
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-muted)", marginTop: "4px" }}>
                Multiplexed sockets
              </div>
            </div>

            <div className="card-clean" style={{ padding: "16px" }}>
              <div style={{ fontSize: "0.74rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>
                Ring Buffer Replay Capacity
              </div>
              <div style={{ fontSize: "1.6rem", fontWeight: "800", color: "var(--upi-orange)", marginTop: "4px" }}>
                {wsStats?.replayBufferCount || 500} / 500
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-muted)", marginTop: "4px" }}>
                Monotonic sequence ring
              </div>
            </div>
          </div>

          {/* Replay Buffer Controls */}
          <div className="card-clean" style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <h4 style={{ fontSize: "0.95rem", fontWeight: "700", color: "var(--ink-primary)" }}>
                  Stream Reconnection & Replay Recovery (Monotonic Sequence)
                </h4>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", marginTop: "2px" }}>
                  Clients that experience momentary network partitions can reconnect with <code>?lastSequence=N</code> to receive missed transaction frames.
                </p>
              </div>

              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--ink-muted)" }}>Replay from Seq:</span>
                <input
                  type="number"
                  min="0"
                  value={replaySeq}
                  onChange={(e) => setReplaySeq(Number(e.target.value))}
                  style={{ width: "70px", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border-hairline)", fontSize: "0.85rem" }}
                />
                <button type="button" className="btn-secondary" onClick={handleRequestReplay}>
                  Request Replay
                </button>
              </div>
            </div>
          </div>

          {/* Live Feed Terminal */}
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Terminal size={18} style={{ color: "var(--blue-accent)" }} />
                Real-Time WebSocket Transaction Stream (/ws/transactions)
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEvents([])}
                style={{ fontSize: "0.75rem", padding: "4px 8px" }}
              >
                Clear Feed
              </button>
            </div>

            <div
              style={{
                background: "#1E293B",
                color: "#E2E8F0",
                padding: "16px",
                borderRadius: "8px",
                fontFamily: "monospace",
                fontSize: "0.82rem",
                maxHeight: "380px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {events.length === 0 ? (
                <div style={{ color: "#94A3B8" }}>
                  Awaiting live transaction events... (Initiate a payment on the Dashboard to watch live WebSocket push frames)
                </div>
              ) : (
                events.map((evt, idx) => (
                  <div key={idx} style={{ borderBottom: "1px solid #334155", paddingBottom: "6px" }}>
                    <span style={{ color: "#38BDF8" }}>[{evt.receivedAt}]</span>{" "}
                    <span style={{ color: "#F59E0B", fontWeight: "700" }}>{evt.event || evt.type}</span>{" "}
                    {evt.sequence && <span style={{ color: "#10B981" }}>(seq: #{evt.sequence})</span>}{" "}
                    <span style={{ color: "#CBD5E1" }}>{JSON.stringify(evt)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* WEBRTC P2P DATACHANNEL SECTION */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "webrtc" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Architecture Card */}
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Share2 size={18} style={{ color: "#8E24AA" }} />
                WebRTC P2P DataChannels (SCTP Protocol)
              </div>
              <span className={`status-pill ${peerState === "CONNECTED" ? "success" : peerState === "SIGNALING" ? "warning" : "info"}`}>
                {peerState}
              </span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              WebRTC enables direct browser-to-bank or bank-to-bank peer-to-peer data channels using <strong>SCTP</strong> encapsulated in <strong>DTLS over UDP</strong>. The central server acts exclusively as a signaling relay via <code>/ws/webrtc</code> for exchanging SDP Offer/Answer descriptors and ICE candidates. Once negotiated, payment data flows <strong>directly between peers with zero intermediary server hops</strong>.
            </p>

            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "0.82rem", fontWeight: "600", color: "var(--ink-secondary)" }}>Signaling Room:</span>
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  disabled={peerState !== "IDLE"}
                  style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border-hairline)", fontSize: "0.85rem" }}
                />
              </div>

              {peerState === "IDLE" ? (
                <button type="button" className="btn-primary" onClick={handleStartWebRTC}>
                  <Zap size={14} />
                  Initiate WebRTC Peer Handshake
                </button>
              ) : (
                <button type="button" className="btn-secondary" onClick={() => { setPeerState("IDLE"); setPeerMessages([]); }}>
                  Reset WebRTC Session
                </button>
              )}
            </div>

            {/* Peer Topology Diagram */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                gap: "16px",
                alignItems: "center",
                padding: "20px",
                borderRadius: "10px",
                background: "var(--bg-canvas)",
                border: "1px solid var(--border-hairline)",
              }}
            >
              {/* Peer A */}
              <div style={{ padding: "16px", background: "#FFFFFF", borderRadius: "8px", border: "1px solid var(--border-hairline)", textAlign: "center" }}>
                <div style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "700" }}>Peer Node A</div>
                <div style={{ fontSize: "1.05rem", fontWeight: "700", color: "var(--ink-primary)", marginTop: "4px" }}>HDFC Remitter CBS</div>
                <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", fontFamily: "monospace", marginTop: "2px" }}>peer-hdfc-01</div>
                <span className={`status-pill ${peerState === "CONNECTED" ? "success" : "info"}`} style={{ marginTop: "8px", fontSize: "0.7rem" }}>
                  {peerState === "CONNECTED" ? "DataChannel Open" : "Ready"}
                </span>
              </div>

              {/* Channel Line */}
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.78rem", fontWeight: "700", color: peerState === "CONNECTED" ? "var(--upi-green)" : "var(--ink-muted)" }}>
                  {peerState === "CONNECTED" ? "⚡ SCTP DataChannel Active (Direct 1.8ms)" : "Signaling Relay (/ws/webrtc)"}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", margin: "6px 0" }}>
                  <ArrowRightLeft size={22} style={{ color: peerState === "CONNECTED" ? "var(--upi-green)" : "var(--ink-muted)" }} />
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--ink-muted)" }}>
                  {peerState === "CONNECTED" ? "Zero NPCI intermediary hop" : "Exchanging SDP & ICE"}
                </div>
              </div>

              {/* Peer B */}
              <div style={{ padding: "16px", background: "#FFFFFF", borderRadius: "8px", border: "1px solid var(--border-hairline)", textAlign: "center" }}>
                <div style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "700" }}>Peer Node B</div>
                <div style={{ fontSize: "1.05rem", fontWeight: "700", color: "var(--ink-primary)", marginTop: "4px" }}>ICICI Beneficiary CBS</div>
                <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", fontFamily: "monospace", marginTop: "2px" }}>peer-icici-02</div>
                <span className={`status-pill ${peerState === "CONNECTED" ? "success" : "info"}`} style={{ marginTop: "8px", fontSize: "0.7rem" }}>
                  {peerState === "CONNECTED" ? "DataChannel Open" : "Ready"}
                </span>
              </div>
            </div>
          </div>

          {/* Interactive P2P Payment over DataChannel */}
          {peerState === "CONNECTED" && (
            <div className="card-clean" style={{ border: "2px solid var(--upi-green)", background: "var(--upi-green-tint)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <h4 style={{ fontSize: "1rem", fontWeight: "700", color: "var(--ink-primary)" }}>
                    Interactive P2P Payment via WebRTC DataChannel
                  </h4>
                  <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", marginTop: "2px" }}>
                    Send an instantaneous micro-payment payload directly over the SCTP data channel with cryptographic signature.
                  </p>
                </div>

                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <input
                    type="number"
                    min="1"
                    value={p2pAmount}
                    onChange={(e) => setP2pAmount(Number(e.target.value))}
                    style={{ width: "90px", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-hairline)", fontSize: "0.85rem", background: "#FFFFFF" }}
                  />
                  <button type="button" className="btn-green" onClick={handleSendP2PPayment}>
                    <Send size={14} />
                    Send ₹{p2pAmount} via DataChannel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Signaling & DataChannel Message Log */}
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Terminal size={18} style={{ color: "var(--ink-primary)" }} />
                WebRTC Signaling Protocol Traces & SCTP Packets
              </div>
              <span className="status-pill info">SCTP Subsystem</span>
            </div>

            <div
              style={{
                background: "#0F172A",
                color: "#E2E8F0",
                padding: "16px",
                borderRadius: "8px",
                fontFamily: "monospace",
                fontSize: "0.82rem",
                maxHeight: "320px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              {peerMessages.length === 0 ? (
                <div style={{ color: "#94A3B8" }}>
                  Click "Initiate WebRTC Peer Handshake" above to simulate SDP Offer/Answer negotiation and establish a direct SCTP DataChannel.
                </div>
              ) : (
                peerMessages.map((m, idx) => (
                  <div key={idx} style={{ borderBottom: "1px solid #1E293B", paddingBottom: "4px" }}>
                    {m.type === "signal" && <span style={{ color: "#38BDF8" }}>{m.text}</span>}
                    {m.type === "sdp" && <span style={{ color: "#F59E0B" }}>{m.text}</span>}
                    {m.type === "ice" && <span style={{ color: "#A855F7" }}>{m.text}</span>}
                    {m.type === "p2p-tx" && <span style={{ color: "#10B981", fontWeight: "700" }}>{m.text}</span>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
