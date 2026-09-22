import { useEffect, useState } from "react";
import PageShell from "../components/layout/PageShell";
import { fetchUsers, initiateTransaction, connectTransactionSocket } from "../api";
import { ArrowRight, Send, CheckCircle2, AlertCircle, RefreshCw, Server, Hash, UserCheck, ShieldAlert } from "lucide-react";
import "../styles.css";

function getDisplayName(input) {
  if (!input || !input.trim()) return "—";
  const trimmed = input.trim();
  if (trimmed.includes("/")) {
    return trimmed.split("/")[0].trim();
  }
  if (trimmed.includes("@")) {
    const base = trimmed.split("@")[0].trim();
    return base.charAt(0).toUpperCase() + base.slice(1);
  }
  return trimmed;
}

function getUpiId(input) {
  if (!input || !input.trim()) return "";
  const trimmed = input.trim();
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/").map((s) => s.trim());
    for (const p of parts) {
      if (p.includes("@")) return p;
    }
    return parts[parts.length - 1];
  }
  if (trimmed.includes("@")) {
    return trimmed;
  }
  return `${trimmed.toLowerCase()}@bank`;
}

export default function TransferView() {
  const [senderInput, setSenderInput] = useState("Sanika / sanika@bank");
  const [receiverInput, setReceiverInput] = useState("Navya / navya@bank");
  const [amount, setAmount] = useState(500);
  const [idempotencyKey, setIdempotencyKey] = useState(`IDEM-${Date.now()}`);
  const [mode, setMode] = useState("rest");

  const [submitting, setSubmitting] = useState(false);
  const [activeTxn, setActiveTxn] = useState(null);
  const [error, setError] = useState(null);
  const [connStatus, setConnStatus] = useState("connecting");

  useEffect(() => {
    fetchUsers().catch(() => {});

    const ws = connectTransactionSocket((evt) => {
      if (evt.transactionId && activeTxn && evt.transactionId === activeTxn.transactionId) {
        setActiveTxn((prev) => ({
          ...prev,
          status: evt.status || prev?.status,
          timeline: [...(prev?.timeline || []), evt],
        }));
      }
    }, setConnStatus);

    return () => ws.close();
  }, [activeTxn]);

  async function handleLaunch(e) {
    e.preventDefault();
    setError(null);

    const senderTrimmed = senderInput.trim();
    const receiverTrimmed = receiverInput.trim();

    if (!senderTrimmed) {
      setError("Please enter a sender.");
      return;
    }
    if (!receiverTrimmed) {
      setError("Please enter a receiver.");
      return;
    }

    const senderUpi = getUpiId(senderTrimmed);
    const receiverUpi = getUpiId(receiverTrimmed);

    if (
      senderTrimmed.toLowerCase() === receiverTrimmed.toLowerCase() ||
      (senderUpi && receiverUpi && senderUpi.toLowerCase() === receiverUpi.toLowerCase())
    ) {
      setError("Sender and receiver must be different.");
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Amount must be greater than ₹0.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await initiateTransaction({
        senderId: senderUpi || senderTrimmed,
        receiverId: receiverUpi || receiverTrimmed,
        amount: numAmount,
        idempotencyKey,
        mode,
      });
      setActiveTxn(res);
      setIdempotencyKey(`IDEM-${Date.now()}`);
    } catch (err) {
      setError(err.message || "Transaction launch failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const baseSteps = [
    { key: "TRANSACTION_INITIATED", label: "01 PAYMENT INITIATED", node: "Client App :5173 ➔ Hub :8000" },
    { key: "SENDER_BANK_PROCESSING", label: "02 SENDER BANK PROCESSING", node: "Sender Bank :8001" },
    { key: "SENDER_VERIFIED", label: "03 SENDER VERIFIED & DEBITED", node: "Sender Bank :8001" },
    { key: "NPCI_PROCESSING", label: "04 NPCI SWITCH ROUTING", node: "NPCI Switch :8002" },
    { key: "NPCI_ROUTED", label: "05 NPCI ROUTED TO RECEIVER", node: "NPCI Switch :8002" },
    { key: "RECEIVER_BANK_PROCESSING", label: "06 RECEIVER BANK CREDIT", node: "Receiver Bank :8003" },
    { key: "TRANSACTION_COMPLETED", label: "07 PAYMENT COMPLETED", node: "SQLite Persistence Engine" },
  ];

  const senderName = getDisplayName(senderInput);
  const receiverName = getDisplayName(receiverInput);

  return (
    <PageShell connStatus={connStatus}>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">SIMULATOR</h1>
          <p className="page-subtitle">Initiate payment across distributed services</p>
        </div>
      </div>

      {error && (
        <div style={{ maxWidth: 700, margin: "0 auto 20px", padding: "10px 14px", background: "var(--danger-light)", border: "1px solid var(--danger)", borderRadius: "8px", color: "var(--danger)", fontSize: "0.82rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Names, Identifiers and Addresses Panel */}
      <div style={{ maxWidth: 860, margin: "0 auto 24px", background: "#ffffff", border: "1.5px solid var(--border)", borderRadius: "14px", padding: "16px 20px" }}>
        <div style={{ fontSize: "0.74rem", fontWeight: 800, color: "var(--muted)", letterSpacing: "0.05em", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <Server size={14} color="var(--orange-primary)" />
          <span>NAMES, IDENTIFIERS & ADDRESSES</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: "0.78rem" }}>
          <div style={{ background: "rgba(44, 45, 47, 0.03)", padding: 10, borderRadius: "8px" }}>
            <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--muted)", display: "block" }}>
              NAMES (UPI IDs):
            </span>
            <div style={{ fontWeight: 800, marginTop: 2, color: "var(--graphite)" }}>
              {senderName} ➔ {receiverName}
            </div>
          </div>

          <div style={{ background: "rgba(44, 45, 47, 0.03)", padding: 10, borderRadius: "8px" }}>
            <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--muted)", display: "block" }}>
              IDENTIFIER / KEY:
            </span>
            <div className="font-mono" style={{ fontWeight: 800, marginTop: 2, color: "var(--orange-primary)", fontSize: "0.74rem" }}>
              {activeTxn ? activeTxn.transactionId : "TXN-PENDING"} | {idempotencyKey}
            </div>
          </div>

          <div style={{ background: "rgba(44, 45, 47, 0.03)", padding: 10, borderRadius: "8px" }}>
            <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--muted)", display: "block" }}>
              ENDPOINTS & PORTS:
            </span>
            <div className="font-mono" style={{ fontSize: "0.72rem", marginTop: 2, color: "var(--graphite)" }}>
              Hub :8000 | Sender :8001 | NPCI :8002 | Receiver :8003
            </div>
          </div>
        </div>
      </div>

      <div className="composer-spatial-container">
        <form onSubmit={handleLaunch}>
          {/* Visual Payment Composition */}
          <div className="composer-pair">
            <div className="participant-node-box active-participant">
              <span className="font-mono" style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                SENDER
              </span>
              <input
                type="text"
                className="spatial-input font-mono"
                style={{ marginTop: 6, textAlign: "center", fontWeight: 700, fontSize: "0.9rem", padding: "10px 14px" }}
                value={senderInput}
                onChange={(e) => setSenderInput(e.target.value)}
                placeholder="e.g. Sanika / sanika@bank"
              />
            </div>

            <div style={{ color: "var(--orange-primary)" }}>
              <ArrowRight size={32} />
            </div>

            <div className="participant-node-box active-participant">
              <span className="font-mono" style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                RECEIVER
              </span>
              <input
                type="text"
                className="spatial-input font-mono"
                style={{ marginTop: 6, textAlign: "center", fontWeight: 700, fontSize: "0.9rem", padding: "10px 14px" }}
                value={receiverInput}
                onChange={(e) => setReceiverInput(e.target.value)}
                placeholder="e.g. Navya / navya@bank"
              />
            </div>
          </div>

          {/* Amount Input */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <span className="font-mono" style={{ fontSize: "0.75rem", fontWeight: 800, color: "var(--muted)" }}>
              AMOUNT (INR ₹)
            </span>
            <input
              type="number"
              className="amount-spatial-input"
              value={amount}
              min="1"
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          {/* Idempotency Protection Key */}
          <div className="form-group" style={{ marginBottom: 24 }}>
            <label className="form-label font-mono">
              IDEMPOTENCY KEY
            </label>
            <input
              type="text"
              className="spatial-input font-mono"
              style={{ width: "100%" }}
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-trigger-signal" disabled={submitting}>
            {submitting ? <RefreshCw className="spin" size={18} /> : <Send size={18} />}
            <span>{submitting ? "PROCESSING TRANSACTION..." : "SEND PAYMENT →"}</span>
          </button>
        </form>

        {/* Real Live Execution Trace & State Machine */}
        {activeTxn && (
          <div style={{ marginTop: 40, paddingTop: 28, borderTop: "1px dashed var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div className="font-mono" style={{ fontWeight: 800, fontSize: "0.88rem", color: "var(--graphite)" }}>
                LIVE TRANSACTION LIFECYCLE: {activeTxn.transactionId}
              </div>
              <span className={`badge-status ${activeTxn.status}`}>
                {activeTxn.status}
              </span>
            </div>

            {activeTxn.duplicateRequest && (
              <div style={{ marginBottom: 16, padding: 12, background: "rgba(230, 81, 0, 0.1)", border: "1px solid var(--orange-primary)", borderRadius: "8px", fontSize: "0.8rem", color: "var(--orange-primary)", fontWeight: 700 }}>
                ⚡ DUPLICATE REQUEST DETECTED: Returned existing transaction result without re-debiting.
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {baseSteps.map((st) => {
                const events = activeTxn.timeline || [];
                const isExecuted = events.some((e) => e.event === st.key || (st.key === "TRANSACTION_COMPLETED" && (e.event === "SUCCESS" || e.event === "TRANSACTION_COMPLETED")));

                return (
                  <div
                    key={st.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 16px",
                      borderRadius: "8px",
                      background: isExecuted ? "var(--green-light)" : "rgba(44, 45, 47, 0.03)",
                      border: "1px solid",
                      borderColor: isExecuted ? "var(--green-success)" : "var(--border)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <CheckCircle2 size={16} color={isExecuted ? "var(--green-success)" : "var(--muted)"} />
                      <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>{st.label}</span>
                    </div>
                    <span className="font-mono" style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      {st.node}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Dynamic Failure / Retry / Rollback Trace if present */}
            {activeTxn.timeline && activeTxn.timeline.some((e) => e.event?.includes("FAILURE") || e.event?.includes("RETRY") || e.event?.includes("ROLLBACK") || activeTxn.status === "FAILED") && (
              <div style={{ marginTop: 16, padding: 16, background: "var(--danger-light)", border: "1.5px solid var(--danger)", borderRadius: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--danger)", fontWeight: 800, fontSize: "0.85rem", marginBottom: 8 }}>
                  <ShieldAlert size={18} />
                  <span>
                    {activeTxn.timeline.some((e) => e.event === "ROLLBACK_FAILED")
                      ? "COMPENSATING ROLLBACK FAILED — MANUAL RECONCILIATION REQUIRED"
                      : activeTxn.timeline.some((e) => e.event === "ROLLBACK_COMPLETED")
                      ? "COMPENSATING ROLLBACK EXECUTED SUCCESSFULLY — SENDER DEBIT RESTORED"
                      : "FAULT TOLERANCE & RECOVERY IN PROGRESS"}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.78rem" }}>
                  {activeTxn.timeline.filter((e) => e.event?.includes("FAILURE") || e.event?.includes("RETRY") || e.event?.includes("ROLLBACK") || e.event?.includes("FAILED")).map((e, idx) => (
                    <div key={idx} className="font-mono" style={{ display: "flex", justifyContent: "space-between", color: "var(--graphite)" }}>
                      <span>[{e.service || "Fault Handler"}] {e.event}: {e.message || e.reason}</span>
                      <span style={{ color: "var(--muted)" }}>{new Date(e.timestamp || Date.now()).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}

