import { useEffect, useState } from "react";
import PageShell from "../components/layout/PageShell";
import { fetchTransactions } from "../api";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import "../styles.css";

export default function LedgerView() {
  const [transactions, setTransactions] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadLedger() {
    setLoading(true);
    try {
      const txns = await fetchTransactions();
      setTransactions(txns);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLedger();
  }, []);

  return (
    <PageShell>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">LEDGER</h1>
          <p className="page-subtitle">Persisted transaction state history</p>
        </div>
        <button
          className="dock-item"
          style={{ border: "1px solid var(--border)", background: "#ffffff", padding: "6px 14px" }}
          onClick={loadLedger}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>
          Loading state ledger...
        </div>
      ) : transactions.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>
          No transaction history recorded yet.
        </div>
      ) : (
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          {transactions.map((txn) => {
            const isExpanded = expandedId === txn.transactionId;

            return (
              <div
                key={txn.transactionId}
                style={{
                  background: "#ffffff",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  padding: "18px 24px",
                  marginBottom: 12,
                  cursor: "pointer",
                  transition: "all 0.2s var(--ease-smooth)",
                }}
                onClick={() => setExpandedId(isExpanded ? null : txn.transactionId)}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <span className={`badge-status ${txn.status}`}>{txn.status}</span>
                    <div>
                      <div className="font-mono" style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--graphite)" }}>
                        {txn.transactionId}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "var(--graphite-secondary)", marginTop: 2 }}>
                        {txn.senderId} ➔ {txn.receiverId}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                    <div style={{ textAlign: "right" }}>
                      <div className="font-mono" style={{ fontWeight: 800, fontSize: "1.1rem" }}>₹{txn.amount}</div>
                      <div className="font-mono" style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                        {new Date(txn.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </div>

                {/* Inline Distributed Transaction Trace */}
                {isExpanded && (
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px dashed var(--border)" }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "var(--muted)", marginBottom: 10 }}>
                      DISTRIBUTED TRANSACTION TRACE (IDEMPOTENCY KEY: {txn.idempotencyKey || "NONE"})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(txn.timeline || []).map((e, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 12px",
                            background: "rgba(44, 45, 47, 0.03)",
                            borderRadius: "6px",
                            fontSize: "0.78rem",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontWeight: 700, color: "var(--graphite)" }}>{e.service}</span>
                            <span style={{ color: "var(--graphite-secondary)" }}>— {e.event}</span>
                          </div>
                          <span className="font-mono" style={{ color: "var(--muted)" }}>
                            {new Date(e.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
