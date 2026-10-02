import { useState, useEffect, useRef } from "react";
import PageShell from "../components/layout/PageShell";
import { Send, Zap } from "lucide-react";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const INR_FORMAT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function WebRTCView() {
  const [dataChannelState, setDataChannelState] = useState("closed");
  const [connectionState, setConnectionState] = useState("new");

  const [senderId, setSenderId] = useState("sanika@bank");
  const [receiverId, setReceiverId] = useState("navya@bank");
  const [amount, setAmount] = useState(500);

  const [logs, setLogs] = useState([]);
  const [telemetry, setTelemetry] = useState({
    sentMsgs: 0,
    recvMsgs: 0,
    sentBytes: 0,
    recvBytes: 0,
    rttMs: null,
  });

  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const loopbackPeerRef = useRef(null);
  const sendTimeRef = useRef(null);

  const addLog = (tag, message) => {
    setLogs((prev) => [
      {
        time: new Date().toLocaleTimeString(),
        tag,
        message,
      },
      ...prev.slice(0, 40),
    ]);
  };

  const setupDataChannelEvents = (dc) => {
    dcRef.current = dc;
    dc.onopen = () => {
      setDataChannelState("open");
      addLog("CHANNEL", "RTCDataChannel 'upi-p2p' OPEN");
    };

    dc.onclose = () => {
      setDataChannelState("closed");
    };

    dc.onmessage = (event) => {
      try {
        const text = event.data;
        const bytes = new Blob([text]).size;
        const data = JSON.parse(text);

        setTelemetry((prev) => ({
          ...prev,
          recvMsgs: prev.recvMsgs + 1,
          recvBytes: prev.recvBytes + bytes,
        }));

        if (data.type === "transaction-ack") {
          const rtt = sendTimeRef.current
            ? Math.max(1, Math.round(performance.now() - sendTimeRef.current))
            : 1;
          addLog("RX ACK", `${data.transactionId} settled (${rtt} ms)`);
          setTelemetry((prev) => ({ ...prev, rttMs: rtt }));
        }
      } catch {
        // ignore
      }
    };
  };

  const handleInstantLoopbackConnect = async () => {
    if (pcRef.current) pcRef.current.close();
    if (loopbackPeerRef.current) loopbackPeerRef.current.close();

    const pcA = new RTCPeerConnection(RTC_CONFIG);
    const pcB = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pcA;
    loopbackPeerRef.current = pcB;

    pcA.onconnectionstatechange = () => setConnectionState(pcA.connectionState);
    pcA.onicecandidate = (e) => {
      if (e.candidate) pcB.addIceCandidate(e.candidate).catch(() => {});
    };
    pcB.onicecandidate = (e) => {
      if (e.candidate) pcA.addIceCandidate(e.candidate).catch(() => {});
    };

    pcB.ondatachannel = (event) => {
      const rxChannel = event.channel;
      rxChannel.onmessage = (msgEvt) => {
        try {
          const parsed = JSON.parse(msgEvt.data);
          if (parsed.type === "transaction") {
            addLog("PEER B RX", `${parsed.transactionId} · ₹${parsed.amount}`);
            rxChannel.send(
              JSON.stringify({
                type: "transaction-ack",
                transactionId: parsed.transactionId,
                status: "SETTLED_P2P",
              })
            );
          }
        } catch {
          // ignore
        }
      };
    };

    const dc = pcA.createDataChannel("upi-p2p");
    setupDataChannelEvents(dc);

    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);

    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
    addLog("SDP", "Peer A ↔ Peer B Handshake Complete");
  };

  const handleSendTransaction = (e) => {
    e.preventDefault();
    if (!dcRef.current || dcRef.current.readyState !== "open") return;

    const payload = {
      type: "transaction",
      transactionId: `P2P-${Date.now().toString(36).toUpperCase()}`,
      senderId,
      receiverId,
      amount: parseFloat(amount) || 500,
    };

    const text = JSON.stringify(payload);
    sendTimeRef.current = performance.now();
    dcRef.current.send(text);

    const bytes = new Blob([text]).size;
    setTelemetry((prev) => ({
      ...prev,
      sentMsgs: prev.sentMsgs + 1,
      sentBytes: prev.sentBytes + bytes,
    }));

    addLog("PEER A TX", `${payload.transactionId} · ${INR_FORMAT.format(payload.amount)}`);
  };

  useEffect(() => {
    handleInstantLoopbackConnect();
    return () => {
      if (pcRef.current) pcRef.current.close();
      if (loopbackPeerRef.current) loopbackPeerRef.current.close();
    };
  }, []);

  const isOpen = dataChannelState === "open";

  return (
    <PageShell connStatus={isOpen ? "connected" : "connecting"}>
      <div className="page-header">
        <div>
          <h1 className="page-title">WebRTC P2P DataChannel</h1>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={handleInstantLoopbackConnect}
        >
          <Zap size={14} />
          <span>Reconnect Peers</span>
        </button>
      </div>

      {/* Visual P2P Laser Conduit Banner */}
      <div
        className="surface-panel"
        style={{
          marginBottom: 20,
          padding: "24px 32px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <svg width="100%" height="90" viewBox="0 0 800 90">
          <defs>
            <filter id="p2p-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <path id="p2p-beam" d="M 140 45 C 320 15, 480 75, 660 45" />
          </defs>

          <use
            href="#p2p-beam"
            className={`wire-stream ${isOpen ? "settled" : ""}`}
          />

          {isOpen && (
            <>
              <circle r="6" fill="#00E599" filter="url(#p2p-glow)">
                <animateMotion dur="0.9s" repeatCount="indefinite">
                  <mpath href="#p2p-beam" />
                </animateMotion>
              </circle>
              <circle r="5" fill="#FF6B00" filter="url(#p2p-glow)">
                <animateMotion dur="0.9s" begin="0.45s" repeatCount="indefinite">
                  <mpath href="#p2p-beam" />
                </animateMotion>
              </circle>
            </>
          )}

          <g transform="translate(80, 45)">
            <rect x="-65" y="-24" width="130" height="48" rx="10" fill="#0D121D" stroke="#FF6B00" strokeWidth="1.5" />
            <text x="0" y="5" textAnchor="middle" fill="#F8FAFC" fontSize="13" fontWeight="700" fontFamily="Playfair Display, Georgia, serif">
              PEER A (TX)
            </text>
          </g>

          <g transform="translate(720, 45)">
            <rect x="-65" y="-24" width="130" height="48" rx="10" fill="#0D121D" stroke="#00E599" strokeWidth="1.5" />
            <text x="0" y="5" textAnchor="middle" fill="#F8FAFC" fontSize="13" fontWeight="700" fontFamily="Playfair Display, Georgia, serif">
              PEER B (RX)
            </text>
          </g>
        </svg>
      </div>

      <div className="kpi-strip">
        <div className="kpi-cell">
          <span className="kpi-label">DataChannel</span>
          <span className="kpi-value" style={{ color: isOpen ? "var(--emerald)" : "var(--saffron)" }}>
            {dataChannelState.toUpperCase()}
          </span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Peer State</span>
          <span className="kpi-value">{connectionState.toUpperCase()}</span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Packets</span>
          <span className="kpi-value">{telemetry.sentMsgs + telemetry.recvMsgs}</span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Direct RTT</span>
          <span className="kpi-value">
            {telemetry.rttMs !== null ? `${telemetry.rttMs} ms` : "1 ms"}
          </span>
        </div>
      </div>

      <div className="sandbox-split">
        <div className="surface-panel">
          <form onSubmit={handleSendTransaction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 600, color: "var(--ink-secondary)", marginBottom: 4 }}>
                  Peer A VPA
                </label>
                <input
                  type="text"
                  className="field-input font-mono"
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 600, color: "var(--ink-secondary)", marginBottom: 4 }}>
                  Peer B VPA
                </label>
                <input
                  type="text"
                  className="field-input font-mono"
                  value={receiverId}
                  onChange={(e) => setReceiverId(e.target.value)}
                />
              </div>
            </div>

            <div>
              <span style={{ fontSize: "0.74rem", fontWeight: 600, color: "var(--ink-secondary)" }}>
                Amount (₹)
              </span>
              <input
                type="number"
                min="1"
                className="rupee-display-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={!isOpen}
            >
              <Send size={15} />
              <span>Beam ₹{amount} via WebRTC</span>
            </button>
          </form>
        </div>

        <div className="surface-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span className="font-mono" style={{ fontWeight: 700, fontSize: "0.84rem" }}>
              RTCDataChannel Packets ({telemetry.sentBytes + telemetry.recvBytes} B)
            </span>
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: "4px 10px", minHeight: 30, fontSize: "0.74rem" }}
              onClick={() => setLogs([])}
            >
              Clear
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {logs.map((lg, idx) => (
              <div
                key={idx}
                className="font-mono"
                style={{
                  padding: "8px 12px",
                  background: "var(--bg-subtle)",
                  borderLeft: "2px solid",
                  borderLeftColor: lg.tag.includes("RX")
                    ? "var(--emerald)"
                    : lg.tag.includes("TX")
                    ? "var(--saffron)"
                    : "var(--ink-secondary)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.76rem",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  <strong style={{ color: "var(--ink-primary)" }}>[{lg.tag}]</strong> {lg.message}
                </span>
                <span style={{ color: "var(--ink-muted)" }}>{lg.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
