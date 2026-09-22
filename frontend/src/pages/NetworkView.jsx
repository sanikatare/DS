import { useEffect, useState } from "react";
import PageShell from "../components/layout/PageShell";
import { fetchAllServicesHealth, fetchStats, connectTransactionSocket } from "../api";
import { ShieldCheck, X, CheckCircle2 } from "lucide-react";
import "../styles.css";

export default function NetworkView() {
  const [healthMap, setHealthMap] = useState({});
  const [stats, setStats] = useState({ total: 0, successful: 0, failed: 0, processing: 0 });
  const [selectedNode, setSelectedNode] = useState(null);

  const [activeTxn, setActiveTxn] = useState(null);
  const [lastCompletedTxn, setLastCompletedTxn] = useState(null);
  const [connStatus, setConnStatus] = useState("connecting");

  async function loadNetworkData() {
    try {
      const [h, s] = await Promise.all([fetchAllServicesHealth(), fetchStats()]);
      setHealthMap(h);
      setStats(s);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadNetworkData();
    const ws = connectTransactionSocket((evt) => {
      if (evt.transactionId) {
        setActiveTxn(evt);
        if (evt.status === "SUCCESS") {
          setLastCompletedTxn(evt);
          setTimeout(() => setLastCompletedTxn(null), 4500);
        }
      }
      loadNetworkData();
    }, setConnStatus);
    return () => ws.close();
  }, []);

  const nodes = [
    {
      id: "client",
      title: "Client App",
      subtitle: "Origin",
      port: ":5173",
      role: "Client Request Origin",
      db: "Browser State",
      type: "client",
      top: "14%",
      left: "50%",
    },
    {
      id: "transaction-service",
      title: "Transaction Service",
      subtitle: "Orchestrator",
      port: ":8000",
      role: "Transaction Orchestrator",
      db: "upi_simulator.db",
      type: "hub",
      top: "42%",
      left: "50%",
    },
    {
      id: "sender-bank",
      title: "Sender Bank",
      subtitle: "Debit",
      port: ":8001",
      role: "Account Debit Engine",
      db: "sender_bank.db",
      type: "bank",
      top: "76%",
      left: "20%",
    },
    {
      id: "npci",
      title: "NPCI Switch",
      subtitle: "Routing",
      port: ":8002",
      role: "Interbank Routing Switch",
      db: "Switch Router",
      type: "switch",
      top: "76%",
      left: "50%",
    },
    {
      id: "receiver-bank",
      title: "Receiver Bank",
      subtitle: "Credit",
      port: ":8003",
      role: "Account Credit Engine",
      db: "receiver_bank.db",
      type: "bank",
      top: "76%",
      left: "80%",
    },
  ];

  const currentStatus = activeTxn?.status || "IDLE";
  const isProcessing = currentStatus === "PROCESSING" || currentStatus === "INITIATED";
  const isSuccess = currentStatus === "SUCCESS" || lastCompletedTxn !== null;

  return (
    <PageShell connStatus={connStatus}>
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: "20px" }}>
        <div>
          <h1 className="page-title" style={{ fontSize: "1.75rem", fontWeight: 900 }}>TOPOLOGY</h1>
          <p className="page-subtitle" style={{ fontSize: "0.8rem", color: "var(--graphite-secondary)", marginTop: "2px" }}>
            Service topology
          </p>
        </div>
      </div>

      {/* Metrics Control Strip */}
      <div className="metrics-strip-container">
        <div className="metric-cell">
          <span className="metric-label">ACTIVE REQUESTS</span>
          <span className="metric-value metric-value-orange">
            {stats.processing || (isProcessing ? 1 : 0)}
          </span>
        </div>
        <div className="metric-cell-divider" />
        <div className="metric-cell">
          <span className="metric-label">TOTAL TRANSACTIONS</span>
          <span className="metric-value metric-value-graphite">
            {stats.total}
          </span>
        </div>
        <div className="metric-cell-divider" />
        <div className="metric-cell">
          <span className="metric-label">SUCCESS RATE</span>
          <span className="metric-value metric-value-green">
            {stats.total > 0 ? ((stats.successful / stats.total) * 100).toFixed(1) : "100.0"}%
          </span>
        </div>
      </div>

      {/* Hero Spatial Canvas Wrapper */}
      <div className="hero-canvas-container">
        {/* Ambient Glows */}
        <div className="glow-layer-orange" />
        <div className="glow-layer-green" />

        {/* SVG Interconnection Layer */}
        <svg className="hero-svg-layer">
          {/* Client -> Transaction Orchestrator */}
          <line
            x1="50%"
            y1="21.3%"
            x2="50%"
            y2="32.0%"
            className={`hero-path ${isProcessing ? "path-active" : isSuccess ? "path-settled" : ""}`}
          />

          {/* Transaction Orchestrator -> Sender Bank */}
          <line
            x1="50%"
            y1="52.0%"
            x2="20%"
            y2="67.1%"
            className={`hero-path ${isProcessing ? "path-active" : isSuccess ? "path-settled" : ""}`}
          />

          {/* Transaction Orchestrator -> NPCI Switch */}
          <line
            x1="50%"
            y1="52.0%"
            x2="50%"
            y2="67.1%"
            className={`hero-path ${isProcessing ? "path-active" : isSuccess ? "path-settled" : ""}`}
          />

          {/* Transaction Orchestrator -> Receiver Bank */}
          <line
            x1="50%"
            y1="52.0%"
            x2="80%"
            y2="67.1%"
            className={`hero-path ${isProcessing ? "path-active" : isSuccess ? "path-settled" : ""}`}
          />

          {/* Particle Signals during active request */}
          {isProcessing && (
            <>
              <circle className="particle-dot" cx="50%" cy="26.6%" />
              <circle className="particle-dot" cx="35%" cy="59.5%" />
              <circle className="particle-dot" cx="50%" cy="59.5%" />
              <circle className="particle-dot" cx="65%" cy="59.5%" />
            </>
          )}
        </svg>

        {/* Spatial Microservice Nodes */}
        {nodes.map((node) => {
          const isSelected = selectedNode?.id === node.id;
          const health = healthMap[node.id]?.status || "healthy";
          const isHub = node.type === "hub";
          const isClient = node.type === "client";

          if (isClient) {
            return (
              <div
                key={node.id}
                className={`hero-node node-client-app ${isSelected ? "selected" : ""}`}
                style={{ top: node.top, left: node.left }}
                onClick={() => setSelectedNode(node)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: 800, color: "var(--graphite)" }}>
                    {node.title}
                  </span>
                  <span className="font-mono" style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--orange-primary)" }}>
                    {node.port}
                  </span>
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--graphite-secondary)", fontWeight: 600, marginBottom: 8 }}>
                  {node.subtitle} • {node.db}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span className={`dot-status ${health === "healthy" ? "healthy" : "disrupted"}`} />
                    <span className="font-mono" style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--green-success)" }}>
                      OPERATIONAL
                    </span>
                  </div>
                </div>
              </div>
            );
          }

          if (isHub) {
            return (
              <div
                key={node.id}
                className={`hero-node node-central-engine ${isProcessing ? "processing" : ""} ${isSelected ? "selected" : ""}`}
                style={{ top: node.top, left: node.left }}
                onClick={() => setSelectedNode(node)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.92rem", fontWeight: 900, color: "var(--graphite)" }}>
                    {node.title}
                  </span>
                  <span className="font-mono" style={{ fontSize: "0.75rem", fontWeight: 800, color: "var(--orange-primary)" }}>
                    {node.port}
                  </span>
                </div>
                <div>
                  <span className="orchestrator-badge">ORCHESTRATOR</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="font-mono" style={{ fontSize: "0.7rem", color: "var(--muted)", fontWeight: 600 }}>
                    {node.db}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span className={`dot-status ${health === "healthy" ? "healthy" : "disrupted"}`} />
                    <span className="font-mono" style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--green-success)" }}>
                      OPERATIONAL
                    </span>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={node.id}
              className={`hero-node node-downstream ${isSelected ? "selected" : ""}`}
              style={{ top: node.top, left: node.left }}
              onClick={() => setSelectedNode(node)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 800, color: "var(--graphite)" }}>
                  {node.title}
                </span>
                <span className="font-mono" style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--orange-primary)" }}>
                  {node.port}
                </span>
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--graphite-secondary)", fontWeight: 600, marginBottom: 12 }}>
                {node.subtitle.toUpperCase()}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="font-mono" style={{ fontSize: "0.68rem", color: "var(--muted)", fontWeight: 600 }}>
                  {node.db}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span className={`dot-status ${health === "healthy" ? "healthy" : "disrupted"}`} />
                  <span className="font-mono" style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--green-success)" }}>
                    OPERATIONAL
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Successful Settlement Toast Banner */}
        {lastCompletedTxn && (
          <div className="settlement-toast font-mono">
            <CheckCircle2 size={18} />
            <span>PAYMENT CONFIRMED: {lastCompletedTxn.transactionId}</span>
          </div>
        )}
      </div>

      {/* Floating Node Telemetry Inspector */}
      {selectedNode && (
        <div className="telemetry-inspector">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 900 }}>{selectedNode.title}</h3>
              <span className="font-mono" style={{ fontSize: "0.75rem", color: "var(--orange-primary)", fontWeight: 800 }}>
                {selectedNode.subtitle}
              </span>
            </div>
            <button
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}
              onClick={() => setSelectedNode(null)}
            >
              <X size={18} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: "0.82rem" }}>
            <div>
              <span style={{ color: "var(--muted)", fontSize: "0.72rem", fontWeight: 800 }}>SERVICE ROLE</span>
              <div style={{ fontWeight: 700 }}>{selectedNode.role}</div>
            </div>

            <div>
              <span style={{ color: "var(--muted)", fontSize: "0.72rem", fontWeight: 800 }}>ENDPOINT PORT</span>
              <div className="font-mono" style={{ fontWeight: 800, color: "var(--orange-primary)", fontSize: "0.9rem" }}>
                Port {selectedNode.port}
              </div>
            </div>

            <div>
              <span style={{ color: "var(--muted)", fontSize: "0.72rem", fontWeight: 800 }}>SQLITE DATABASE</span>
              <div className="font-mono" style={{ fontSize: "0.8rem", color: "var(--graphite)" }}>{selectedNode.db}</div>
            </div>

            <div style={{ marginTop: 4, padding: "8px 12px", background: "var(--green-light)", border: "1px solid var(--green-success)", borderRadius: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.78rem", fontWeight: 800, color: "var(--green-success)" }}>
                <ShieldCheck size={16} />
                <span>Isolated Microservice Instance</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
