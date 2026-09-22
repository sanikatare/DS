import { useEffect, useState, useRef } from "react";
import PageShell from "../components/layout/PageShell";
import { connectTransactionSocket, fetchTransactions, fetchWebSocketStats } from "../api";
import "../styles.css";

export default function SignalsView() {
  const [events, setEvents] = useState([]);
  const [connStatus, setConnStatus] = useState("connecting");
  const [latestSeq, setLatestSeq] = useState(0);
  const socketRef = useRef(null);

  useEffect(() => {
    fetchTransactions()
      .then((txns) => {
        const allEvts = txns.flatMap((t) =>
          (t.timeline || []).map((e, idx) => ({
            ...e,
            sequence: e.sequence || idx + 1,
            transactionId: t.transactionId,
          }))
        );
        allEvts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        setEvents(allEvts);
        const maxSeq = allEvts.reduce((max, e) => Math.max(max, e.sequence || 0), 0);
        if (maxSeq > 0) {
          setLatestSeq((prev) => Math.max(prev, maxSeq));
        }
      })
      .catch(() => {});

    fetchWebSocketStats()
      .then((s) => {
        if (s && s.totalSequence) {
          setLatestSeq((prev) => Math.max(prev, s.totalSequence));
        }
      })
      .catch(() => {});

    const ws = connectTransactionSocket((evt) => {
      if (evt.sequence) {
        setLatestSeq((prev) => Math.max(prev, evt.sequence));
      }
      if (evt.totalSequence) {
        setLatestSeq((prev) => Math.max(prev, evt.totalSequence));
      }
      setEvents((prev) => [evt, ...prev]);
    }, setConnStatus);

    socketRef.current = ws;

    return () => ws.close();
  }, []);

  const handlePing = () => {
    if (socketRef.current) socketRef.current.sendPing();
  };

  const handleReplay = () => {
    if (socketRef.current) socketRef.current.requestReplay(Math.max(1, latestSeq - 10));
  };

  const handleClear = () => {
    setEvents([]);
    setLatestSeq(0);
  };


  return (
    <PageShell connStatus={connStatus}>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">COMMUNICATION</h1>
          <p className="page-subtitle">Chapter 2 paradigms across microservices</p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={handlePing}
            style={{
              padding: "6px 14px",
              fontSize: "0.78rem",
              fontWeight: 700,
              background: "#ffffff",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            PING SERVER
          </button>

          <button
            onClick={handleReplay}
            style={{
              padding: "6px 14px",
              fontSize: "0.78rem",
              fontWeight: 700,
              background: "#ffffff",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            REPLAY EVENTS
          </button>

          <button
            onClick={handleClear}
            style={{
              padding: "6px 14px",
              fontSize: "0.78rem",
              fontWeight: 700,
              background: "#ffffff",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            CLEAR STREAM
          </button>
        </div>
      </div>

      {/* Protocol Paradigm Visual Cards */}
      <div className="ui-grid-5" style={{ marginBottom: 24 }}>
        {[
          { title: "HTTP / REST", flow: "Request ➔ Response", tech: "HTTP/1.1 JSON", status: "ACTIVE" },
          { title: "gRPC / RPC", flow: "Client ➔ Server", tech: "HTTP/2 Protobuf", status: "ACTIVE" },
          { title: "RabbitMQ", flow: "Producer ➔ Queue ➔ Consumer", tech: "AMQP 0-9-1", status: "ACTIVE" },
          { title: "WebSocket", flow: "Server ➔ Client", tech: "WS / TCP", status: connStatus.toUpperCase() },
          { title: "P2P Messaging", flow: "Sender Bank ➔ Receiver Bank", tech: "Direct REST", status: "ACTIVE" },
        ].map((card, idx) => (
          <div
            key={idx}
            className="ui-card"
            style={{
              padding: 16,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "var(--graphite)", marginBottom: 4 }}>{card.title}</div>
              <div className="font-mono" style={{ fontSize: "0.72rem", color: "var(--orange-primary)", fontWeight: 700, marginBottom: 12 }}>{card.flow}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="font-mono" style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--muted)" }}>{card.tech}</span>
              <span className="badge-status SUCCESS" style={{ fontSize: "0.64rem" }}>{card.status}</span>
            </div>
          </div>
        ))}
      </div>

      <div
        className="font-mono"
        style={{
          display: "flex",
          gap: 24,
          padding: "14px 20px",
          background: "#1E293B",
          color: "#F8FAFC",
          borderRadius: "12px",
          marginBottom: 24,
          fontSize: "0.8rem",
          fontWeight: 700,
        }}
      >
        <div>WEBSOCKET STATUS: <span style={{ color: connStatus === "connected" ? "#4ADE80" : "#F87171" }}>{connStatus.toUpperCase()}</span></div>
        <div>FRAMES RECORDED: <span style={{ color: "#38BDF8" }}>{events.length}</span></div>
        <div>LATEST SEQUENCE: <span style={{ color: "#FACC15" }}>#{latestSeq}</span></div>
        <div>STREAM MODE: <span style={{ color: "#E2E8F0" }}>LIVE BROADCAST</span></div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", background: "#ffffff", border: "1.5px solid var(--graphite)", borderRadius: "16px", padding: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "70px 110px 180px 220px 1fr", gap: 16, paddingBottom: 12, borderBottom: "2px solid var(--graphite)", fontWeight: 800, fontSize: "0.75rem", color: "var(--muted)", letterSpacing: "0.05em" }}>
          <span>SEQ</span>
          <span>TIME</span>
          <span>SERVICE</span>
          <span>EVENT TYPE</span>
          <span>DESCRIPTION</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {events.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: "0.85rem" }}>
              No stream telemetry frames recorded yet. Initiate a payment transaction to observe real-time event streaming.
            </div>
          ) : (
            events.map((ev, idx) => {
              const evtName = ev.eventType || ev.event || "SIGNAL";
              const isSuccess = evtName.includes("SUCCESS") || evtName.includes("COMPLETED");
              const isFailed = evtName.includes("FAILED") || evtName.includes("DECLINED");

              return (
                <div
                  key={idx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "70px 110px 180px 220px 1fr",
                    gap: 16,
                    padding: "12px 0",
                    borderBottom: "1px solid var(--border)",
                    alignItems: "center",
                    fontSize: "0.85rem",
                  }}
                >
                  <span className="font-mono" style={{ fontSize: "0.8rem", fontWeight: 800, color: "var(--orange-primary)" }}>
                    #{ev.sequence || "-"}
                  </span>
                  <span className="font-mono" style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                    {new Date(ev.timestamp || Date.now()).toLocaleTimeString()}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--graphite)" }}>
                    {ev.service || ev.source || "System Engine"}
                  </span>
                  <div>
                    <span
                      className={`badge-status ${isSuccess ? "SUCCESS" : isFailed ? "FAILED" : "PROCESSING"}`}
                      style={{ fontSize: "0.7rem" }}
                    >
                      {evtName}
                    </span>
                  </div>
                  <span style={{ color: "var(--graphite-secondary)", fontSize: "0.82rem" }}>
                    {ev.message || ev.reason || evtName} {ev.transactionId ? `(txn: ${ev.transactionId})` : ""}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </PageShell>
  );
}
