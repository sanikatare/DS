import { useEffect, useState, useCallback } from "react";
import PageShell from "../components/layout/PageShell";
import { fetchTransactions, initiateTransaction, connectTransactionSocket } from "../api";
import { RefreshCw, ChevronDown, ChevronUp, Send } from "lucide-react";

const INR_FORMAT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function LedgerView() {
  const [transactions, setTransactions] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [connStatus, setConnStatus] = useState("connecting");

  const loadLedger = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const txns = await fetchTransactions();
      setTransactions(txns || []);
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLedger(false);
    const ws = connectTransactionSocket((evt) => {
      const evName = evt.eventType || evt.event || "";
      if (
        evName.includes("SUCCESS") ||
        evName.includes("COMPLETED") ||
        evName.includes("FAILED") ||
        evName.includes("INITIATED")
      ) {
        loadLedger(true);
      }
    }, setConnStatus);
    return () => ws.close();
  }, [loadLedger]);

  async function handleQuickSample() {
    setSeeding(true);
    try {
      await initiateTransaction({
        senderId: "sanika@bank",
        receiverId: "navya@bank",
        amount: 750,
        idempotencyKey: `SAMPLE-${Date.now()}`,
        mode: "rest",
      });
      await loadLedger(true);
    } catch (err) {
      console.error(err);
    } finally {
      setSeeding(false);
    }
  }

  const filteredTxns = transactions.filter((txn) => {
    if (statusFilter === "SUCCESS" && txn.status !== "SUCCESS") return false;
    if (
      statusFilter === "FAILED" &&
      txn.status !== "FAILED" &&
      txn.status !== "ROLLBACK_COMPLETED"
    ) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        txn.transactionId?.toLowerCase().includes(q) ||
        txn.senderId?.toLowerCase().includes(q) ||
        txn.receiverId?.toLowerCase().includes(q) ||
        txn.idempotencyKey?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const settledVolume = transactions
    .filter((t) => t.status === "SUCCESS")
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const settledCount = transactions.filter((t) => t.status === "SUCCESS").length;
  const failedCount = transactions.filter(
    (t) => t.status === "FAILED" || t.status === "ROLLBACK_COMPLETED"
  ).length;

  return (
    <PageShell connStatus={connStatus}>
      <div className="page-header">
        <div>
          <h1 className="page-title">UPI Passbook</h1>
          <div className="meta-inline" style={{ marginTop: 4 }}>
            <span
              className="font-mono"
              style={{ color: connStatus === "connected" ? "var(--emerald)" : "var(--saffron)" }}
            >
              {connStatus === "connected" ? "● LIVE LEDGER SYNC" : "○ CONNECTING"}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className="btn-secondary"
            disabled={seeding}
            onClick={handleQuickSample}
          >
            {seeding ? <RefreshCw size={14} className="spin" /> : <Send size={14} />}
            <span>+ ₹750 Pulse</span>
          </button>
          <button type="button" className="btn-secondary" onClick={() => loadLedger(false)}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="kpi-strip">
        <div className="kpi-cell">
          <span className="kpi-label">Settled Volume</span>
          <span className="kpi-value" style={{ color: "var(--emerald)" }}>
            {INR_FORMAT.format(settledVolume)}
          </span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Entries</span>
          <span className="kpi-value">{transactions.length}</span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Settled</span>
          <span className="kpi-value">{settledCount}</span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Rolled Back</span>
          <span
            className="kpi-value"
            style={{ color: failedCount > 0 ? "var(--crimson)" : "var(--ink-primary)" }}
          >
            {failedCount}
          </span>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div className="segmented-group">
          {[
            { id: "ALL", label: `All (${transactions.length})` },
            { id: "SUCCESS", label: `Settled (${settledCount})` },
            { id: "FAILED", label: `Failed (${failedCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`segmented-btn ${statusFilter === tab.id ? "active" : ""}`}
              onClick={() => setStatusFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          className="field-input font-mono"
          style={{ maxWidth: 280 }}
          placeholder="Search Txn / VPA..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Ledger Table */}
      <div className="surface-panel" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 44, textAlign: "center", color: "var(--ink-muted)" }}>
            Loading...
          </div>
        ) : filteredTxns.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <button
              type="button"
              className="btn-primary"
              disabled={seeding}
              onClick={handleQuickSample}
            >
              <Send size={15} />
              <span>Trigger ₹750 UPI Transfer</span>
            </button>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>UTR / Reference</th>
                <th>Flow</th>
                <th>Idempotency</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th style={{ textAlign: "right" }}>Time</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {filteredTxns.map((txn) => {
                const isExpanded = expandedId === txn.transactionId;
                const isSuccess = txn.status === "SUCCESS";

                return (
                  <LedgerRow
                    key={txn.transactionId}
                    txn={txn}
                    isExpanded={isExpanded}
                    isSuccess={isSuccess}
                    onToggle={() =>
                      setExpandedId(isExpanded ? null : txn.transactionId)
                    }
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  );
}

function LedgerRow({ txn, isExpanded, isSuccess, onToggle }) {
  return (
    <>
      <tr className="interactive-row" onClick={onToggle}>
        <td>
          <span className={`status-text ${isSuccess ? "status-nominal" : "status-critical"}`}>
            {isSuccess ? "✓ SETTLED" : `✕ ${txn.status}`}
          </span>
        </td>
        <td className="font-mono" style={{ fontWeight: 600 }}>
          {txn.transactionId}
        </td>
        <td className="font-mono" style={{ fontSize: "0.8rem", color: "var(--ink-secondary)" }}>
          {txn.senderId} → {txn.receiverId}
        </td>
        <td className="font-mono" style={{ fontSize: "0.75rem", color: "var(--ink-muted)" }}>
          {txn.idempotencyKey || "—"}
        </td>
        <td
          className="font-mono tabular-nums"
          style={{
            textAlign: "right",
            fontWeight: 700,
            color: isSuccess ? "var(--emerald)" : "var(--ink-primary)",
          }}
        >
          {INR_FORMAT.format(txn.amount)}
        </td>
        <td
          className="font-mono tabular-nums"
          style={{ textAlign: "right", fontSize: "0.76rem", color: "var(--ink-muted)" }}
        >
          {new Date(txn.createdAt).toLocaleTimeString()}
        </td>
        <td style={{ textAlign: "right", color: "var(--ink-muted)" }}>
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={7} style={{ background: "rgba(6, 8, 14, 0.65)", padding: "14px 20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(txn.timeline || []).map((e, idx) => (
                <div
                  key={idx}
                  className="font-mono"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "180px 220px 1fr 100px",
                    gap: 12,
                    padding: "7px 12px",
                    background: "var(--bg-subtle)",
                    border: "1px solid var(--border-hairline)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.76rem",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--ink-primary)" }}>{e.service}</span>
                  <span style={{ color: "var(--saffron)" }}>{e.event}</span>
                  <span style={{ color: "var(--ink-secondary)" }}>{e.message || e.event}</span>
                  <span style={{ textAlign: "right", color: "var(--ink-muted)" }}>
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
