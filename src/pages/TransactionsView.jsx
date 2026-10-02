import { useState, useEffect, useCallback } from "react";
import PageShell from "../components/layout/PageShell";
import {
  fetchTransactions,
  initiateTransaction,
  connectTransactionSocket,
} from "../api";
import {
  Receipt,
  Search,
  Filter,
  RefreshCw,
  PlusCircle,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Radio,
  Zap,
  Share2,
  MessageSquare,
  ArrowRight,
  Shield,
  Layers,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const INR_FORMAT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function TransactionsView() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connStatus, setConnStatus] = useState("connecting");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [modeFilter, setModeFilter] = useState("ALL");
  const [expandedTxnId, setExpandedTxnId] = useState(null);

  // Quick initiate form state
  const [senderId, setSenderId] = useState("sanika@bank");
  const [receiverId, setReceiverId] = useState("navya@bank");
  const [amount, setAmount] = useState(500);
  const [mode, setMode] = useState("rest");
  const [paying, setPaying] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const data = await fetchTransactions();
      setTransactions(data || []);
      if (!expandedTxnId && data?.length > 0) {
        setExpandedTxnId(data[0].transactionId);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [expandedTxnId]);

  useEffect(() => {
    loadData();
    const ws = connectTransactionSocket(() => loadData(), setConnStatus);
    const interval = setInterval(loadData, 4000);
    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [loadData]);

  async function handleCreateTxn(e) {
    if (e) e.preventDefault();
    setPaying(true);
    try {
      const res = await initiateTransaction({
        senderId,
        receiverId,
        amount: Number(amount),
        mode,
      });
      setExpandedTxnId(res.transactionId);
      await loadData();
      setShowForm(false);
    } catch (err) {
      console.error(err);
    } finally {
      setPaying(false);
    }
  }

  const filtered = transactions.filter((t) => {
    const matchesSearch =
      searchTerm === "" ||
      t.transactionId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.senderId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.receiverId.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "ALL" || t.status === statusFilter;

    const matchesMode =
      modeFilter === "ALL" || (t.mode || "rest").toLowerCase() === modeFilter.toLowerCase();

    return matchesSearch && matchesStatus && matchesMode;
  });

  const totalCount = transactions.length;
  const successCount = transactions.filter((t) => t.status === "SUCCESS").length;
  const failedCount = transactions.filter((t) => t.status === "FAILED").length;
  const processingCount = transactions.filter((t) => t.status === "INITIATED" || t.status === "PROCESSING").length;
  const totalVolume = transactions
    .filter((t) => t.status === "SUCCESS")
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);

  function getModeBadge(m) {
    const modeStr = (m || "rest").toLowerCase();
    if (modeStr === "grpc") return { label: "gRPC Protobuf", color: "var(--upi-orange)", bg: "var(--upi-orange-tint)" };
    if (modeStr === "rabbitmq") return { label: "RabbitMQ AMQP", color: "var(--upi-green)", bg: "var(--upi-green-tint)" };
    if (modeStr === "websocket") return { label: "WebSocket Push", color: "var(--blue-accent)", bg: "rgba(0, 102, 204, 0.08)" };
    if (modeStr === "webrtc") return { label: "WebRTC DataChannel", color: "#8E24AA", bg: "rgba(142, 36, 170, 0.08)" };
    if (modeStr === "p2p") return { label: "P2P Mesh", color: "#00838F", bg: "rgba(0, 131, 143, 0.08)" };
    return { label: "HTTP/1.1 REST", color: "var(--ink-secondary)", bg: "var(--bg-canvas)" };
  }

  return (
    <PageShell connStatus={connStatus}>
      {/* Header Bar */}
      <div className="page-header">
        <div>
          <div
            className="unit-tag"
            style={{
              background: "var(--upi-orange-tint)",
              color: "var(--upi-orange)",
              borderColor: "var(--upi-orange-border)",
            }}
          >
            Transaction Orchestration Engine
          </div>
          <h1 className="page-title">UPI Transactions Journal</h1>
          <p className="page-subtitle">
            Live stream of distributed transactions with Saga orchestrator state transitions, protocol traces, and compensating rollbacks.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={loadData}
            title="Refresh Transactions"
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            Refresh
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowForm(!showForm)}
          >
            <PlusCircle size={14} />
            {showForm ? "Close Form" : "New Transaction"}
          </button>
        </div>
      </div>

      {/* Quick Transaction Creation Form */}
      {showForm && (
        <form
          onSubmit={handleCreateTxn}
          className="card-clean"
          style={{
            marginBottom: "20px",
            border: "2px solid var(--upi-orange)",
            background: "#FFFFFF",
          }}
        >
          <h3 style={{ fontSize: "1rem", fontWeight: "700", marginBottom: "12px", color: "var(--ink-primary)" }}>
            Initiate Real-Time Distributed Transaction
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px", marginBottom: "14px" }}>
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: "600", color: "var(--ink-secondary)", display: "block", marginBottom: "4px" }}>
                Sender VPA
              </label>
              <input
                type="text"
                value={senderId}
                onChange={(e) => setSenderId(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-hairline)", fontSize: "0.85rem" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: "600", color: "var(--ink-secondary)", display: "block", marginBottom: "4px" }}>
                Receiver VPA
              </label>
              <input
                type="text"
                value={receiverId}
                onChange={(e) => setReceiverId(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-hairline)", fontSize: "0.85rem" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: "600", color: "var(--ink-secondary)", display: "block", marginBottom: "4px" }}>
                Amount (₹)
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                min="1"
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-hairline)", fontSize: "0.85rem" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: "600", color: "var(--ink-secondary)", display: "block", marginBottom: "4px" }}>
                Distribution Protocol
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-hairline)", fontSize: "0.85rem", background: "#FFFFFF" }}
              >
                <option value="rest">HTTP/1.1 REST</option>
                <option value="grpc">gRPC Protobuf (HTTP/2)</option>
                <option value="rabbitmq">RabbitMQ AMQP Queue</option>
                <option value="websocket">WebSocket Push Stream</option>
                <option value="p2p">Direct P2P Mesh</option>
                <option value="webrtc">WebRTC DataChannel</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={paying}>
              {paying ? <RefreshCw size={14} className="spin" /> : <Zap size={14} />}
              Send {INR_FORMAT.format(amount)}
            </button>
          </div>
        </form>
      )}

      {/* Metric KPI Strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "14px", marginBottom: "20px" }}>
        <div className="card-clean" style={{ padding: "16px" }}>
          <div style={{ fontSize: "0.74rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>Total Transactions</div>
          <div style={{ fontSize: "1.6rem", fontWeight: "800", color: "var(--ink-primary)", marginTop: "4px" }}>{totalCount}</div>
        </div>

        <div className="card-clean" style={{ padding: "16px" }}>
          <div style={{ fontSize: "0.74rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>Successful (Committed)</div>
          <div style={{ fontSize: "1.6rem", fontWeight: "800", color: "var(--upi-green)", marginTop: "4px" }}>{successCount}</div>
        </div>

        <div className="card-clean" style={{ padding: "16px" }}>
          <div style={{ fontSize: "0.74rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>Failed (Saga Rollbacks)</div>
          <div style={{ fontSize: "1.6rem", fontWeight: "800", color: "var(--crimson)", marginTop: "4px" }}>{failedCount}</div>
        </div>

        <div className="card-clean" style={{ padding: "16px" }}>
          <div style={{ fontSize: "0.74rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>Processing / In-Flight</div>
          <div style={{ fontSize: "1.6rem", fontWeight: "800", color: "var(--blue-accent)", marginTop: "4px" }}>{processingCount}</div>
        </div>

        <div className="card-clean" style={{ padding: "16px" }}>
          <div style={{ fontSize: "0.74rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>Total Volume Settled</div>
          <div style={{ fontSize: "1.6rem", fontWeight: "800", color: "var(--upi-orange)", marginTop: "4px" }}>{INR_FORMAT.format(totalVolume)}</div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="card-clean" style={{ padding: "14px 18px", marginBottom: "18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ position: "relative", minWidth: "260px", flex: "1" }}>
            <Search size={14} style={{ position: "absolute", left: "12px", top: "11px", color: "var(--ink-muted)" }} />
            <input
              type="text"
              placeholder="Search by Txn ID (TXN-...), sender or receiver VPA..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px 8px 34px",
                borderRadius: "6px",
                border: "1px solid var(--border-hairline)",
                fontSize: "0.85rem",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid var(--border-hairline)",
                fontSize: "0.82rem",
                background: "#FFFFFF",
              }}
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">Success Only</option>
              <option value="FAILED">Failed Only</option>
              <option value="PROCESSING">Processing</option>
              <option value="INITIATED">Initiated</option>
            </select>

            {/* Mode Filter */}
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid var(--border-hairline)",
                fontSize: "0.82rem",
                background: "#FFFFFF",
              }}
            >
              <option value="ALL">All Protocols</option>
              <option value="rest">HTTP/1.1 REST</option>
              <option value="grpc">gRPC (HTTP/2)</option>
              <option value="rabbitmq">RabbitMQ AMQP</option>
              <option value="websocket">WebSocket Stream</option>
              <option value="p2p">Direct P2P</option>
              <option value="webrtc">WebRTC DataChannel</option>
            </select>
          </div>
        </div>
      </div>

      {/* Transaction List & Detailed Timelines */}
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {filtered.length === 0 ? (
          <div className="card-clean" style={{ padding: "40px", textAlign: "center", color: "var(--ink-muted)" }}>
            No transactions found matching your criteria.
          </div>
        ) : (
          filtered.map((txn) => {
            const isExpanded = expandedTxnId === txn.transactionId;
            const modeInfo = getModeBadge(txn.mode);
            const isSuccess = txn.status === "SUCCESS";
            const isFailed = txn.status === "FAILED";

            return (
              <div
                key={txn.transactionId}
                className="card-clean"
                style={{
                  border: isExpanded ? "2px solid var(--upi-green)" : "1px solid var(--border-hairline)",
                  transition: "all 0.15s ease",
                  padding: "0",
                  overflow: "hidden",
                }}
              >
                {/* Card Summary Header */}
                <div
                  style={{
                    padding: "16px 20px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    background: isExpanded ? "var(--bg-canvas)" : "#FFFFFF",
                  }}
                  onClick={() => setExpandedTxnId(isExpanded ? null : txn.transactionId)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        background: isSuccess ? "var(--upi-green-tint)" : isFailed ? "var(--crimson-tint)" : "rgba(0, 102, 204, 0.08)",
                        color: isSuccess ? "var(--upi-green)" : isFailed ? "var(--crimson)" : "var(--blue-accent)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {isSuccess ? <CheckCircle2 size={18} /> : isFailed ? <AlertTriangle size={18} /> : <Clock size={18} />}
                    </div>

                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontWeight: "700", fontFamily: "monospace", fontSize: "0.95rem" }}>
                          {txn.transactionId}
                        </span>
                        <span
                          style={{
                            fontSize: "0.72rem",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            fontWeight: "700",
                            background: modeInfo.bg,
                            color: modeInfo.color,
                          }}
                        >
                          {modeInfo.label}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", marginTop: "3px", display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontFamily: "monospace", color: "var(--ink-primary)" }}>{txn.senderId}</span>
                        <ArrowRight size={12} />
                        <span style={{ fontFamily: "monospace", color: "var(--ink-primary)" }}>{txn.receiverId}</span>
                        <span style={{ color: "var(--ink-muted)", fontSize: "0.74rem" }}>
                          • {new Date(txn.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "1.15rem", fontWeight: "800", color: isFailed ? "var(--ink-muted)" : "var(--ink-primary)" }}>
                        {INR_FORMAT.format(txn.amount)}
                      </div>
                      <span className={`status-pill ${isSuccess ? "success" : isFailed ? "danger" : "info"}`} style={{ fontSize: "0.7rem" }}>
                        {txn.status}
                      </span>
                    </div>

                    <button
                      type="button"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)" }}
                    >
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </div>

                {/* Expanded Details & Saga Timeline */}
                {isExpanded && (
                  <div style={{ padding: "18px 24px", borderTop: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginBottom: "18px", padding: "12px", background: "var(--bg-canvas)", borderRadius: "8px" }}>
                      <div>
                        <div style={{ fontSize: "0.72rem", color: "var(--ink-muted)", textTransform: "uppercase" }}>Idempotency Key</div>
                        <div style={{ fontSize: "0.8rem", fontFamily: "monospace", color: "var(--ink-primary)" }}>{txn.idempotencyKey || "N/A"}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.72rem", color: "var(--ink-muted)", textTransform: "uppercase" }}>Initiated At</div>
                        <div style={{ fontSize: "0.8rem", color: "var(--ink-primary)" }}>{new Date(txn.createdAt).toLocaleString()}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.72rem", color: "var(--ink-muted)", textTransform: "uppercase" }}>Execution Path</div>
                        <div style={{ fontSize: "0.8rem", color: "var(--ink-primary)" }}>Sender CBS → NPCI Switch → Beneficiary CBS</div>
                      </div>
                      {txn.failureReason && (
                        <div>
                          <div style={{ fontSize: "0.72rem", color: "var(--crimson)", textTransform: "uppercase", fontWeight: "700" }}>Failure Reason</div>
                          <div style={{ fontSize: "0.8rem", color: "var(--crimson)", fontWeight: "600" }}>{txn.failureReason}</div>
                        </div>
                      )}
                    </div>

                    {/* Step-by-Step Saga Timeline */}
                    <h4 style={{ fontSize: "0.88rem", fontWeight: "700", marginBottom: "12px", color: "var(--ink-primary)" }}>
                      Distributed Saga Execution Timeline & Node State Traces
                    </h4>

                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", position: "relative" }}>
                      {(txn.timeline || []).map((step, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "12px",
                            padding: "8px 12px",
                            borderRadius: "6px",
                            background: step.event.includes("FAIL") || step.event.includes("ROLLBACK")
                              ? "var(--crimson-tint)"
                              : step.event.includes("SUCCESS") || step.event.includes("COMPLETED")
                              ? "var(--upi-green-tint)"
                              : "transparent",
                            border: "1px solid var(--border-hairline)",
                          }}
                        >
                          <span
                            style={{
                              width: "22px",
                              height: "22px",
                              borderRadius: "50%",
                              background: "var(--ink-primary)",
                              color: "#FFFFFF",
                              fontSize: "0.7rem",
                              fontWeight: "700",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              marginTop: "2px",
                            }}
                          >
                            {idx + 1}
                          </span>

                          <div style={{ flex: "1" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <strong style={{ fontSize: "0.82rem", color: "var(--ink-primary)" }}>
                                {step.event}
                              </strong>
                              <span style={{ fontSize: "0.72rem", color: "var(--ink-muted)", fontFamily: "monospace" }}>
                                {step.service || "coordinator"}
                              </span>
                            </div>
                            <div style={{ fontSize: "0.8rem", color: "var(--ink-secondary)", marginTop: "2px" }}>
                              {step.message}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </PageShell>
  );
}
