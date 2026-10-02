import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import PageShell from "../components/layout/PageShell";
import {
  fetchSnapshot,
  initiateTransaction,
  connectTransactionSocket,
  resetSystem,
} from "../api";
import {
  Zap,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Server,
  Layers,
  Activity,
  CreditCard,
  Clock,
  ExternalLink,
  BookOpen,
  Receipt,
  Radio,
} from "lucide-react";

export default function DashboardView() {
  const [searchParams] = useSearchParams();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connStatus, setConnStatus] = useState("connecting");

  // Transfer form state
  const [senderId, setSenderId] = useState("sanika@bank");
  const [receiverId, setReceiverId] = useState("navya@bank");
  const [amount, setAmount] = useState(500);
  const [mode, setMode] = useState("rest");
  const [paying, setPaying] = useState(false);
  const [activeTxn, setActiveTxn] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const loadData = useCallback(async () => {
    try {
      const snap = await fetchSnapshot();
      setSnapshot(snap);
      if (snap?.transactions?.length > 0 && !activeTxn) {
        setActiveTxn(snap.transactions[0]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeTxn]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 3000);

    const ws = connectTransactionSocket((evt) => {
      loadData();
    }, setConnStatus);

    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [loadData]);

  async function handlePay(e) {
    if (e) e.preventDefault();
    setErrorMsg("");
    setPaying(true);
    try {
      const res = await initiateTransaction({
        senderId,
        receiverId,
        amount: Number(amount),
        mode,
      });
      setActiveTxn(res);
      await loadData();
    } catch (err) {
      setErrorMsg(err.message || "Payment execution failed");
    } finally {
      setPaying(false);
    }
  }

  const stats = snapshot?.stats || { total: 0, successful: 0, failed: 0, processing: 0 };
  const successRate = stats.total > 0 ? Math.round((stats.successful / stats.total) * 100) : 100;
  const health = snapshot?.health || {};

  return (
    <PageShell connStatus={connStatus}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="unit-tag">
            <Activity size={12} />
            Live Network Overview
          </div>
          <h1 className="page-title">UPI Network Dashboard</h1>
          <p className="page-subtitle">
            Real-time status of the 4 distributed bank nodes, interbank routing switch, and multi-protocol transactions.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={loadData}
            title="Refresh network telemetry"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Tiles */}
      <div className="kpi-grid">
        <div className="kpi-tile kpi-orange">
          <div className="kpi-label">
            <CreditCard size={14} style={{ color: "var(--upi-orange)" }} />
            Total Volume
          </div>
          <div className="kpi-val tabular-nums">{stats.total}</div>
          <div className="kpi-sub">Processed transactions</div>
        </div>

        <div className="kpi-tile kpi-green">
          <div className="kpi-label">
            <CheckCircle2 size={14} style={{ color: "var(--upi-green)" }} />
            Success Rate
          </div>
          <div className="kpi-val tabular-nums">{successRate}%</div>
          <div className="kpi-sub">{stats.successful} settled / {stats.failed} aborted</div>
        </div>

        <div className="kpi-tile kpi-blue">
          <div className="kpi-label">
            <Server size={14} style={{ color: "var(--blue-accent)" }} />
            Distributed Nodes
          </div>
          <div className="kpi-val tabular-nums">4 / 4</div>
          <div className="kpi-sub">All microservice nodes online</div>
        </div>

        <div className="kpi-tile">
          <div className="kpi-label">
            <ShieldCheck size={14} style={{ color: "var(--amber)" }} />
            Circuit Breakers
          </div>
          <div className="kpi-val tabular-nums">Nominal</div>
          <div className="kpi-sub">3-state fault tolerance active</div>
        </div>
      </div>

      {/* Quick-Access Dedicated Pages Hub */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px", marginBottom: "24px" }}>
        <Link
          to="/ledger"
          className="card-clean"
          style={{
            textDecoration: "none",
            padding: "16px",
            border: "1px solid var(--border-hairline)",
            background: "#FFFFFF",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            transition: "all 0.16s ease",
          }}
        >
          <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: "var(--upi-green-tint)", color: "var(--upi-green)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <BookOpen size={20} />
          </div>
          <div>
            <div style={{ fontWeight: "700", color: "var(--ink-primary)", fontSize: "0.95rem" }}>Multi-Bank Ledger →</div>
            <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>Double-entry journal & account balances</div>
          </div>
        </Link>

        <Link
          to="/transactions"
          className="card-clean"
          style={{
            textDecoration: "none",
            padding: "16px",
            border: "1px solid var(--border-hairline)",
            background: "#FFFFFF",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            transition: "all 0.16s ease",
          }}
        >
          <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: "var(--upi-orange-tint)", color: "var(--upi-orange)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Receipt size={20} />
          </div>
          <div>
            <div style={{ fontWeight: "700", color: "var(--ink-primary)", fontSize: "0.95rem" }}>Transactions Only →</div>
            <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>Saga lifecycle traces & protocol logs</div>
          </div>
        </Link>

        <Link
          to="/webrtc-stream"
          className="card-clean"
          style={{
            textDecoration: "none",
            padding: "16px",
            border: "1px solid var(--border-hairline)",
            background: "#FFFFFF",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            transition: "all 0.16s ease",
          }}
        >
          <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: "rgba(0, 102, 204, 0.08)", color: "var(--blue-accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Radio size={20} />
          </div>
          <div>
            <div style={{ fontWeight: "700", color: "var(--ink-primary)", fontSize: "0.95rem" }}>WebRTC & WebSocket →</div>
            <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>P2P DataChannels & push streams</div>
          </div>
        </Link>
      </div>

      {/* Main Dual Grid: Quick Transfer + Cluster Nodes */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "22px", marginBottom: "26px" }}>
        {/* Quick Payment Simulator */}
        <div className="card-clean">
          <div className="card-header-bar">
            <div className="card-title">
              <Zap size={18} style={{ color: "var(--upi-orange)" }} />
              Initiate UPI Payment
            </div>
            <span className="status-pill success">Live Engine</span>
          </div>

          <form onSubmit={handlePay} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div className="form-group">
                <label className="form-label">Remitter VPA (Sender)</label>
                <input
                  type="text"
                  className="form-input"
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                  placeholder="sanika@bank"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Beneficiary VPA (Receiver)</label>
                <input
                  type="text"
                  className="form-input"
                  value={receiverId}
                  onChange={(e) => setReceiverId(e.target.value)}
                  placeholder="navya@bank"
                  required
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div className="form-group">
                <label className="form-label">Amount (₹ INR)</label>
                <input
                  type="number"
                  className="form-input"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  min="1"
                  required
                />
                <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                  {[100, 500, 1000, 2500].map((v) => (
                    <button
                      key={v}
                      type="button"
                      className="seg-pill"
                      style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                      onClick={() => setAmount(v)}
                    >
                      ₹{v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Transport Protocol</label>
                <select
                  className="form-select"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="rest">REST (HTTP/1.1 Synchronous)</option>
                  <option value="grpc">gRPC (HTTP/2 Binary RPC)</option>
                  <option value="rabbitmq">AMQP (RabbitMQ Queue)</option>
                  <option value="websocket">WebSocket (Push Stream)</option>
                  <option value="p2p">Direct P2P (Bypass NPCI)</option>
                </select>
              </div>
            </div>

            {errorMsg && (
              <div className="status-pill danger" style={{ borderRadius: "8px", padding: "8px 12px" }}>
                <AlertTriangle size={14} />
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              className="btn-primary"
              disabled={paying}
              style={{ width: "100%", marginTop: "6px" }}
            >
              {paying ? (
                <>
                  <RefreshCw size={15} className="spin" />
                  Orchestrating 2-Phase Interbank Sagas...
                </>
              ) : (
                <>
                  <Zap size={15} />
                  Authorize & Pay ₹{amount} via {mode.toUpperCase()}
                </>
              )}
            </button>
          </form>
        </div>

        {/* Transaction Timeline Cut */}
        <div className="card-clean">
          <div className="card-header-bar">
            <div className="card-title">
              <Clock size={18} style={{ color: "var(--upi-green)" }} />
              Latest Transaction Lifecycle
            </div>
            {activeTxn && (
              <span className={`status-pill ${activeTxn.status === "SUCCESS" ? "success" : activeTxn.status === "FAILED" ? "danger" : "warning"}`}>
                {activeTxn.status}
              </span>
            )}
          </div>

          {activeTxn ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "14px", fontSize: "0.84rem", color: "var(--ink-secondary)" }}>
                <span>ID: <strong>{activeTxn.transactionId}</strong></span>
                <span>Amount: <strong style={{ color: "var(--upi-green)" }}>₹{activeTxn.amount}</strong></span>
                <span>Mode: <strong>{activeTxn.mode?.toUpperCase()}</strong></span>
              </div>

              <div className="timeline-track">
                {(activeTxn.timeline || []).map((step, idx) => (
                  <div key={idx} className="timeline-step success">
                    <div className="timeline-bullet">✓</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <strong style={{ fontSize: "0.88rem", color: "var(--ink-primary)" }}>{step.event}</strong>
                      <div style={{ display: "flex", gap: "8px", fontSize: "0.74rem" }}>
                        {step.lamport && (
                          <span style={{ color: "var(--upi-orange)", fontWeight: 700 }}>L={step.lamport}</span>
                        )}
                        {step.vector && (
                          <span style={{ color: "var(--upi-green)", fontWeight: 700 }}>V=[{step.vector.join(",")}]</span>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--ink-secondary)" }}>
                      {step.service}: {step.message}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink-muted)" }}>
              No transactions recorded yet. Click "Authorize & Pay" to test the distributed pipeline.
            </div>
          )}
        </div>
      </div>

      {/* 4 Distributed Nodes Status */}
      <div className="card-clean" style={{ marginBottom: "26px" }}>
        <div className="card-header-bar">
          <div className="card-title">
            <Server size={18} style={{ color: "var(--upi-orange)" }} />
            Distributed Payment Nodes (Cluster Topology)
          </div>
          <span className="status-pill info">4 Service Mesh Instances</span>
        </div>

        <div className="nodes-grid">
          {/* Node 1 */}
          <div className="node-card">
            <div className="node-card-header">
              <span className="node-name">Sender Bank Service</span>
              <span className="node-port">:8001</span>
            </div>
            <div style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
              Remitter Core Banking System (CBS). Handles identity verification, debit authorization, and balance updates.
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
              <span className="status-pill success">
                <span className="status-dot"></span>
                Nominal
              </span>
              <span style={{ fontSize: "0.78rem", color: "var(--ink-muted)" }}>Circuit: CLOSED</span>
            </div>
          </div>

          {/* Node 2 */}
          <div className="node-card">
            <div className="node-card-header">
              <span className="node-name">Transaction Coordinator</span>
              <span className="node-port">:8000</span>
            </div>
            <div style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
              Central Orchestrator. Manages 2-Phase Sagas, idempotency keys, Lamport logical clocks, and compensating rollbacks.
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
              <span className="status-pill success">
                <span className="status-dot"></span>
                Coordinator
              </span>
              <span style={{ fontSize: "0.78rem", color: "var(--ink-muted)" }}>REST & WebSockets</span>
            </div>
          </div>

          {/* Node 3 */}
          <div className="node-card">
            <div className="node-card-header">
              <span className="node-name">NPCI Switch Simulator</span>
              <span className="node-port">:8002</span>
            </div>
            <div style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
              National Payments Corporation of India routing hub. Validates VPA address resolutions and routes interbank clearance.
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
              <span className="status-pill success">
                <span className="status-dot"></span>
                Switch Active
              </span>
              <span style={{ fontSize: "0.78rem", color: "var(--ink-muted)" }}>Circuit: CLOSED</span>
            </div>
          </div>

          {/* Node 4 */}
          <div className="node-card">
            <div className="node-card-header">
              <span className="node-name">Receiver Bank Service</span>
              <span className="node-port">:8003</span>
            </div>
            <div style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
              Beneficiary Core Banking System. Records credit settlements and issues signed transaction confirmations.
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
              <span className="status-pill success">
                <span className="status-dot"></span>
                Nominal
              </span>
              <span style={{ fontSize: "0.78rem", color: "var(--ink-muted)" }}>Circuit: CLOSED</span>
            </div>
          </div>
        </div>
      </div>

      {/* Unit Syllabus Navigation Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "18px" }}>
        <Link to="/unit1" style={{ textDecoration: "none" }}>
          <div className="card-clean" style={{ height: "100%", cursor: "pointer", borderTop: "4px solid var(--upi-orange)" }}>
            <div className="unit-tag">Unit I</div>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--ink-primary)", marginBottom: "8px" }}>
              Introduction & Architecture
            </h3>
            <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)", marginBottom: "14px" }}>
              Definition, Goals, 4 Architectures (Layered, Object, Event, P2P), System Types, Design Issues, and NPCI Middleware.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--upi-orange)", fontWeight: 700, fontSize: "0.84rem" }}>
              Explore Unit I <ArrowRight size={14} />
            </div>
          </div>
        </Link>

        <Link to="/unit2" style={{ textDecoration: "none" }}>
          <div className="card-clean" style={{ height: "100%", cursor: "pointer", borderTop: "4px solid var(--upi-green)" }}>
            <div className="unit-tag" style={{ background: "var(--upi-green-tint)", color: "var(--upi-green)", borderColor: "var(--upi-green-border)" }}>
              Unit II
            </div>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--ink-primary)", marginBottom: "8px" }}>
              Communication & Protocols
            </h3>
            <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)", marginBottom: "14px" }}>
              RPC / gRPC (HTTP/2), Message-Oriented (RabbitMQ), WebSockets, P2P Wire, WebRTC, Names/Addresses & Circuit Breakers.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--upi-green)", fontWeight: 700, fontSize: "0.84rem" }}>
              Explore Unit II <ArrowRight size={14} />
            </div>
          </div>
        </Link>

        <Link to="/unit3" style={{ textDecoration: "none" }}>
          <div className="card-clean" style={{ height: "100%", cursor: "pointer", borderTop: "4px solid var(--upi-orange)" }}>
            <div className="unit-tag">Unit III</div>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--ink-primary)", marginBottom: "8px" }}>
              Synchronization & Consensus
            </h3>
            <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)", marginBottom: "14px" }}>
              Clock Sync (Berkeley), Logical Clocks (Lamport), Vector Clocks, Chandy-Lamport Snapshots, Beacons, Bully/Ring Elections & Mutex.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--upi-orange)", fontWeight: 700, fontSize: "0.84rem" }}>
              Explore Unit III <ArrowRight size={14} />
            </div>
          </div>
        </Link>

        <Link to="/unit4" style={{ textDecoration: "none" }}>
          <div className="card-clean" style={{ height: "100%", cursor: "pointer", borderTop: "4px solid var(--blue-accent)" }}>
            <div className="unit-tag" style={{ background: "var(--blue-tint)", color: "var(--blue-accent)", borderColor: "var(--blue-border)" }}>
              Unit IV
            </div>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--ink-primary)", marginBottom: "8px" }}>
              Emerging Distributed Paradigms
            </h3>
            <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)", marginBottom: "14px" }}>
              Distributed Web Systems, Object-Based Systems, Distributed File Systems, Serverless Webhooks, and Case Studies (Cloudflare, AWS, Hadoop, K8s).
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--blue-accent)", fontWeight: 700, fontSize: "0.84rem" }}>
              Explore Unit IV <ArrowRight size={14} />
            </div>
          </div>
        </Link>
      </div>
    </PageShell>
  );
}
