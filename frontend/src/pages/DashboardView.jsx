import { useState, useEffect } from "react";
import PageShell from "../components/layout/PageShell";
import { fetchAllServicesHealth, fetchStats, fetchFailureStatus, initiateTransaction, resetCircuitBreakers, connectTransactionSocket, toggleFailure } from "../api";
import { Activity, ShieldCheck, Server, Radio, Send, RefreshCw, AlertCircle, CheckCircle2, Zap, LayoutDashboard, Layers, Cpu } from "lucide-react";
import "../styles.css";

const TXN_BASE = import.meta.env.VITE_TXN_API_URL || "http://localhost:8000";

export default function DashboardView() {
  const [healthMap, setHealthMap] = useState({});
  const [stats, setStats] = useState({ total: 0, successful: 0, failed: 0, processing: 0 });
  const [cbStatus, setCbStatus] = useState({});
  const [dashboardData, setDashboardData] = useState(null);
  const [connStatus, setConnStatus] = useState("connecting");
  const [submitting, setSubmitting] = useState(false);
  const [demoLog, setDemoLog] = useState([]);
  const [lastTxn, setLastTxn] = useState(null);

  const addDemoLog = (msg, tag = "INFO") => {
    setDemoLog((prev) => [
      { time: new Date().toLocaleTimeString(), msg, tag },
      ...prev.slice(0, 30)
    ]);
  };

  async function loadDashboardData() {
    try {
      const [h, s, f] = await Promise.all([
        fetchAllServicesHealth(),
        fetchStats(),
        fetchFailureStatus()
      ]);
      setHealthMap(h);
      setStats(s);
      setCbStatus(f.circuit_breakers || {});

      // Fetch unified dashboard stats endpoint
      const res = await fetch(`${TXN_BASE}/api/dashboard/stats`);
      if (res.ok) {
        const data = await res.json();
        setDashboardData(data);
      }
    } catch (err) {
      console.error("Dashboard data load error:", err);
    }
  }

  useEffect(() => {
    loadDashboardData();
    const ws = connectTransactionSocket((evt) => {
      if (evt.transactionId) {
        setLastTxn(evt);
        addDemoLog(`[Stream Seq #${evt.sequence || "-"}] ${evt.eventType || evt.event} for ${evt.transactionId}: ${evt.message || evt.status}`, "WS");
      }
      loadDashboardData();
    }, setConnStatus);

    return () => ws.close();
  }, []);

  const handleResetBreakers = async () => {
    try {
      await resetCircuitBreakers();
      addDemoLog("Circuit Breakers manually reset to CLOSED state across all services", "SUCCESS");
      loadDashboardData();
    } catch (err) {
      addDemoLog(`Circuit breaker reset error: ${err.message}`, "ERROR");
    }
  };

  const handleRunPreset = async (mode) => {
    setSubmitting(true);
    const idKey = `DEMO-${mode.toUpperCase()}-${Date.now()}`;
    addDemoLog(`Initiating presentation transaction in [${mode.toUpperCase()}] mode (Key: ${idKey})...`, "TRIGGER");

    try {
      const res = await initiateTransaction({
        senderId: "sanika@bank",
        receiverId: "navya@bank",
        amount: 250,
        idempotencyKey: idKey,
        mode,
      });
      setLastTxn(res);
      addDemoLog(`Transaction ${res.transactionId} settled with status [${res.status}] (mode=${res.mode || mode})`, "SUCCESS");
      loadDashboardData();
    } catch (err) {
      addDemoLog(`Preset transaction failed: ${err.message}`, "ERROR");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleChaos = async () => {
    try {
      const currentFail = dashboardData?.failureState?.npci_failure || false;
      await toggleFailure("npci", !currentFail);
      addDemoLog(`NPCI Switch failure simulation set to [${!currentFail ? "ENABLED" : "DISABLED"}]`, "CHAOS");
      loadDashboardData();
    } catch (err) {
      addDemoLog(`Chaos toggle failed: ${err.message}`, "ERROR");
    }
  };

  const protocolsList = dashboardData?.protocols || [
    { id: "rest", name: "REST / HTTP/1.1", phase: "Phase 0 & 1", type: "Synchronous Req-Resp", transport: "HTTP/1.1 JSON", routing: "Central Hub", npciBypassed: false, status: "Active" },
    { id: "grpc", name: "gRPC / HTTP/2", phase: "Phase 2", type: "Synchronous Binary RPC", transport: "HTTP/2 Protobuf", routing: "Central Hub", npciBypassed: false, status: "Active" },
    { id: "rabbitmq", name: "RabbitMQ AMQP", phase: "Phase 3", type: "Async Message Broker", transport: "AMQP Topic & DLX", routing: "Queue Worker", npciBypassed: false, status: "Active" },
    { id: "websocket", name: "WebSocket Push", phase: "Phase 4", type: "Stream-Oriented Push", transport: "WebSocket TCP", routing: "Ring Buffer (500)", npciBypassed: false, status: "Active" },
    { id: "p2p", name: "Direct P2P HTTP", phase: "Phase 5", type: "Direct Peer Messaging", transport: "HTTP REST", routing: "Direct Bank-to-Bank", npciBypassed: true, status: "Active" },
    { id: "webrtc", name: "WebRTC DataChannel", phase: "Phase 6", type: "Browser P2P DataChannel", transport: "SCTP / DTLS / UDP", routing: "Direct Browser-to-Browser", npciBypassed: true, status: "Active" },
  ];

  return (
    <PageShell connStatus={connStatus}>
      {/* Header Banner */}
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <LayoutDashboard size={24} color="var(--orange-primary)" />
          UNIFIED MONITORING & PROTOCOL COMPARISON DASHBOARD (PHASE 7)
        </h1>
        <p style={{ fontSize: "0.85rem", color: "var(--graphite-secondary)" }}>
          Unified observability across all 6 distributed communication paradigms, microservice health, circuit breakers, and presentation controls.
        </p>
      </div>

      {/* Cluster Health & Ports Grid */}
      <div style={{ maxWidth: 1100, margin: "0 auto 24px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { name: "Transaction Service", port: ":8000", id: "transaction-service", db: "upi_simulator.db", role: "Central Hub Orchestrator" },
          { name: "Sender Bank Core", port: ":8001", id: "sender-bank", db: "sender_bank.db", role: "Debit & Direct P2P Client" },
          { name: "NPCI Switch Router", port: ":8002", id: "npci", db: "Switch Router", role: "Interbank Middleware" },
          { name: "Receiver Bank Core", port: ":8003", id: "receiver-bank", db: "receiver_bank.db", role: "Credit & Peer Endpoint" },
        ].map((svc) => {
          const h = healthMap[svc.id]?.status || "healthy";
          const isHealthy = h === "healthy";
          return (
            <div key={svc.id} style={{ background: "#ffffff", border: "1.5px solid var(--border)", borderRadius: "12px", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontWeight: 800, fontSize: "0.85rem", color: "var(--graphite)" }}>{svc.name}</span>
                <span className="font-mono" style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--orange-primary)" }}>{svc.port}</span>
              </div>
              <div style={{ fontSize: "0.74rem", color: "var(--graphite-secondary)", marginBottom: 10 }}>{svc.role}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="font-mono" style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{svc.db}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className={`dot-status ${isHealthy ? "healthy" : "disrupted"}`} />
                  <span className="font-mono" style={{ fontSize: "0.7rem", fontWeight: 800, color: isHealthy ? "var(--green-success)" : "var(--danger)" }}>
                    {isHealthy ? "ONLINE" : "OFFLINE"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Performance & Fault Tolerance Stat Meter Bar */}
      <div
        className="font-mono"
        style={{
          maxWidth: 1100,
          margin: "0 auto 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          background: "#1E293B",
          color: "#F8FAFC",
          borderRadius: "14px",
          fontSize: "0.82rem",
          fontWeight: 700,
        }}
      >
        <div>TOTAL TRANSACTIONS: <span style={{ color: "#38BDF8" }}>{stats.total}</span></div>
        <div>SUCCESSFUL: <span style={{ color: "#4ADE80" }}>{stats.successful}</span></div>
        <div>FAILED: <span style={{ color: "#F87171" }}>{stats.failed}</span></div>
        <div>SUCCESS RATE: <span style={{ color: "#FACC15" }}>{stats.total > 0 ? ((stats.successful / stats.total) * 100).toFixed(1) : "100.0"}%</span></div>
        <div>STREAM SEQUENCE: <span style={{ color: "#E2E8F0" }}>#{dashboardData?.websocketStream?.totalSequence || 0}</span></div>
      </div>

      {/* 3-State Circuit Breakers Monitor */}
      <div style={{ maxWidth: 1100, margin: "0 auto 24px", background: "#ffffff", border: "1.5px solid var(--border)", borderRadius: "14px", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "var(--graphite)", display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={18} color="var(--orange-primary)" />
            <span>DISTRIBUTED CIRCUIT BREAKER FAULT MONITORING (PHASE 1 INTEGRATION)</span>
          </div>
          <button
            onClick={handleResetBreakers}
            style={{ padding: "6px 14px", fontSize: "0.76rem", fontWeight: 800, background: "var(--graphite-light)", border: "1px solid var(--border)", borderRadius: "8px", cursor: "pointer" }}
          >
            RESET ALL CIRCUIT BREAKERS
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {["sender-bank", "npci", "receiver-bank"].map((key) => {
            const cb = cbStatus[key] || { state: "CLOSED", failureCount: 0, failureThreshold: 3 };
            const isClosed = cb.state === "CLOSED";
            const isOpen = cb.state === "OPEN";

            return (
              <div
                key={key}
                style={{
                  padding: 14,
                  borderRadius: "10px",
                  background: isClosed ? "rgba(46, 125, 50, 0.05)" : isOpen ? "rgba(198, 40, 40, 0.08)" : "rgba(230, 81, 0, 0.08)",
                  border: "1px solid",
                  borderColor: isClosed ? "var(--green-success)" : isOpen ? "var(--danger)" : "var(--orange-primary)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.82rem", fontWeight: 800, textTransform: "uppercase" }}>{key}</span>
                  <span
                    className={`badge-status ${isClosed ? "SUCCESS" : isOpen ? "FAILED" : "PROCESSING"}`}
                    style={{ fontSize: "0.7rem" }}
                  >
                    STATE: {cb.state}
                  </span>
                </div>
                <div className="font-mono" style={{ fontSize: "0.74rem", marginTop: 8, color: "var(--graphite)" }}>
                  Failures: <strong>{cb.failureCount} / {cb.failureThreshold}</strong>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 6-Protocol Comparative Benchmark Matrix */}
      <div style={{ maxWidth: 1100, margin: "0 auto 24px", background: "#ffffff", border: "1.5px solid var(--graphite)", borderRadius: "16px", padding: 24 }}>
        <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--graphite)", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <Layers size={20} color="var(--orange-primary)" />
          <span>PARADIGM COMPARISON MATRIX — ALL 6 DISTRIBUTED COMMUNICATION PROTOCOLS</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ background: "rgba(44, 45, 47, 0.05)", borderBottom: "2px solid var(--graphite)", textAlign: "left" }}>
                <th style={{ padding: "10px 12px" }}>Protocol & Phase</th>
                <th style={{ padding: "10px 12px" }}>Communication Paradigm</th>
                <th style={{ padding: "10px 12px" }}>Transport Layer</th>
                <th style={{ padding: "10px 12px" }}>Routing Topology</th>
                <th style={{ padding: "10px 12px" }}>NPCI Switch</th>
                <th style={{ padding: "10px 12px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {protocolsList.map((p, idx) => (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--border)", background: idx % 2 === 0 ? "#ffffff" : "rgba(44, 45, 47, 0.02)" }}>
                  <td style={{ padding: "12px", fontWeight: 800, color: "var(--graphite)" }}>
                    {p.name}
                    <div style={{ fontSize: "0.7rem", color: "var(--orange-primary)", fontWeight: 700 }}>{p.phase}</div>
                  </td>
                  <td style={{ padding: "12px", fontWeight: 600 }}>{p.type}</td>
                  <td className="font-mono" style={{ padding: "12px", fontSize: "0.76rem", color: "var(--graphite-secondary)" }}>{p.transport}</td>
                  <td style={{ padding: "12px", fontSize: "0.78rem" }}>{p.routing}</td>
                  <td style={{ padding: "12px" }}>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: "6px",
                        fontSize: "0.7rem",
                        fontWeight: 800,
                        background: p.npciBypassed ? "rgba(46, 125, 50, 0.1)" : "rgba(230, 81, 0, 0.1)",
                        color: p.npciBypassed ? "var(--green-success)" : "var(--orange-primary)",
                      }}
                    >
                      {p.npciBypassed ? "BYPASSED ⚡" : "ROUTED"}
                    </span>
                  </td>
                  <td style={{ padding: "12px" }}>
                    <span className="badge-status SUCCESS" style={{ fontSize: "0.68rem" }}>{p.status || "Active"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Presentation Mode: One-Click Demo Presets & Viva Triggers */}
      <div style={{ maxWidth: 1100, margin: "0 auto 24px", background: "#ffffff", border: "1.5px solid var(--border)", borderRadius: "14px", padding: 24 }}>
        <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "var(--graphite)", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={18} color="var(--orange-primary)" />
          <span>ACADEMIC VIVA DEMO PRESETS — ONE-CLICK PROTOCOL SCENARIO TRIGGERS</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
          <button
            onClick={() => handleRunPreset("rest")}
            disabled={submitting}
            className="btn-trigger-signal"
            style={{ padding: "10px 8px", fontSize: "0.72rem", background: "var(--graphite)" }}
          >
            SIMULATE REST
          </button>

          <button
            onClick={() => handleRunPreset("grpc")}
            disabled={submitting}
            className="btn-trigger-signal"
            style={{ padding: "10px 8px", fontSize: "0.72rem", background: "var(--graphite)" }}
          >
            SIMULATE gRPC
          </button>

          <button
            onClick={() => handleRunPreset("rabbitmq")}
            disabled={submitting}
            className="btn-trigger-signal"
            style={{ padding: "10px 8px", fontSize: "0.72rem", background: "var(--graphite)" }}
          >
            SIMULATE RABBITMQ
          </button>

          <button
            onClick={() => handleRunPreset("p2p")}
            disabled={submitting}
            className="btn-trigger-signal"
            style={{ padding: "10px 8px", fontSize: "0.72rem", background: "var(--green-success)" }}
          >
            SIMULATE P2P BYPASS
          </button>

          <button
            onClick={() => window.location.href = "/webrtc"}
            className="btn-trigger-signal"
            style={{ padding: "10px 8px", fontSize: "0.72rem", background: "var(--orange-primary)" }}
          >
            OPEN WEBRTC P2P
          </button>

          <button
            onClick={handleToggleChaos}
            className="btn-trigger-signal"
            style={{ padding: "10px 8px", fontSize: "0.72rem", background: "#C62828" }}
          >
            {dashboardData?.failureState?.npci_failure ? "DISABLE CHAOS" : "TRIGGER NPCI CHAOS"}
          </button>
        </div>
      </div>

      {/* Live Stream Trace & Presentation Log */}
      <div style={{ maxWidth: 1100, margin: "0 auto", background: "#ffffff", border: "1.5px solid var(--graphite)", borderRadius: "16px", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "var(--graphite)" }}>
            REAL-TIME CLUSTER EVENT TRACE & PRESENTATION AUDIT LOG
          </div>
          <button
            onClick={() => setDemoLog([])}
            style={{ padding: "4px 10px", fontSize: "0.72rem", background: "var(--graphite-light)", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer", fontWeight: 700 }}
          >
            CLEAR TRACE
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto" }}>
          {demoLog.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: "0.82rem" }}>
              No presentation events logged yet. Click any protocol scenario preset above to trigger real-time distributed execution.
            </div>
          ) : (
            demoLog.map((item, idx) => (
              <div key={idx} className="font-mono" style={{ fontSize: "0.78rem", padding: "8px 12px", background: "rgba(44, 45, 47, 0.03)", borderRadius: "6px", display: "flex", justifyContent: "space-between" }}>
                <span>
                  <strong style={{ color: item.tag === "SUCCESS" ? "var(--green-success)" : item.tag === "ERROR" || item.tag === "CHAOS" ? "var(--danger)" : "var(--orange-primary)" }}>
                    [{item.tag}]
                  </strong>{" "}
                  {item.msg}
                </span>
                <span style={{ color: "var(--muted)" }}>{item.time}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </PageShell>
  );
}
