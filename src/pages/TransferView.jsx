import { useEffect, useState, useRef, useCallback } from "react";
import PageShell from "../components/layout/PageShell";
import { fetchUsers, initiateTransaction, connectTransactionSocket } from "../api";
import { Send, RefreshCw, CheckCircle2, AlertCircle, ArrowLeftRight } from "lucide-react";

const INR_FORMAT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function getUpiId(input) {
  if (!input || !input.trim()) return "";
  const trimmed = input.trim();
  if (trimmed.includes("@")) return trimmed;
  return `${trimmed.toLowerCase()}@bank`;
}

export default function TransferView() {
  const [users, setUsers] = useState([]);
  const [senderInput, setSenderInput] = useState("sanika@bank");
  const [receiverInput, setReceiverInput] = useState("navya@bank");
  const [amount, setAmount] = useState(500);
  const [idempotencyKey, setIdempotencyKey] = useState(`UPI-IDEM-${Date.now()}`);
  const [lastUsedKey, setLastUsedKey] = useState(null);
  const [mode, setMode] = useState("rest");

  const [submitting, setSubmitting] = useState(false);
  const [activeTxn, setActiveTxn] = useState(null);
  const [error, setError] = useState(null);
  const [connStatus, setConnStatus] = useState("connecting");

  const activeTxnIdRef = useRef(null);
  activeTxnIdRef.current = activeTxn?.transactionId || null;

  const loadUsers = useCallback(async () => {
    try {
      const list = await fetchUsers();
      setUsers(list || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadUsers();
    const ws = connectTransactionSocket((evt) => {
      const evName = evt.eventType || evt.event || "";
      if (
        evt.transactionId &&
        activeTxnIdRef.current &&
        evt.transactionId === activeTxnIdRef.current
      ) {
        setActiveTxn((prev) => {
          if (!prev) return prev;
          const exists = (prev.timeline || []).some(
            (x) => x.event === evName && x.timestamp === evt.timestamp
          );
          return {
            ...prev,
            status: evt.status || prev.status,
            timeline: exists
              ? prev.timeline
              : [...(prev.timeline || []), { ...evt, event: evName }],
          };
        });
      }
      if (
        evName.includes("SUCCESS") ||
        evName.includes("COMPLETED") ||
        evName.includes("ROLLBACK") ||
        evName.includes("FAILED")
      ) {
        loadUsers();
      }
    }, setConnStatus);

    return () => ws.close();
  }, [loadUsers]);

  function handleSwapAccounts() {
    setSenderInput(receiverInput);
    setReceiverInput(senderInput);
  }

  async function executePayment(customKey) {
    setError(null);
    const senderUpi = getUpiId(senderInput);
    const receiverUpi = getUpiId(receiverInput);

    if (!senderUpi || !receiverUpi) {
      setError("Select Remitter & Beneficiary VPA.");
      return;
    }
    if (senderUpi.toLowerCase() === receiverUpi.toLowerCase()) {
      setError("Remitter & Beneficiary must differ.");
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Enter amount > ₹0.");
      return;
    }

    const keyToUse = customKey || idempotencyKey;
    setSubmitting(true);

    try {
      const res = await initiateTransaction({
        senderId: senderUpi,
        receiverId: receiverUpi,
        amount: numAmount,
        idempotencyKey: keyToUse,
        mode,
      });
      setActiveTxn(res);
      setLastUsedKey(keyToUse);
      if (!customKey) {
        setIdempotencyKey(`UPI-IDEM-${Date.now()}`);
      }
      await loadUsers();
    } catch (err) {
      setError(err.message || "Transfer failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const standardSteps = [
    { key: "TRANSACTION_INITIATED", label: "01. Intent Signed", hop: "Hub :8000" },
    { key: "SENDER_BANK_PROCESSING", label: "02. Remitter Check", hop: "Bank :8001" },
    { key: "SENDER_VERIFIED", label: "03. Atomic Debit", hop: "Bank :8001" },
    { key: "NPCI_PROCESSING", label: "04. NPCI Switch", hop: "NPCI :8002" },
    { key: "NPCI_ROUTED", label: "05. Route Cleared", hop: "NPCI :8002" },
    { key: "RECEIVER_BANK_PROCESSING", label: "06. Beneficiary Credit", hop: "Bank :8003" },
    { key: "TRANSACTION_COMPLETED", label: "07. Settled", hop: "Ledger" },
  ];

  const p2pSteps = [
    { key: "P2P_REQUEST_STARTED", label: "01. P2P Intent", hop: "Hub :8000" },
    { key: "P2P_PEER_CONNECTED", label: "02. Peer Link", hop: ":8001 ↔ :8003" },
    { key: "P2P_PEER_REQUEST_SENT", label: "03. Direct Debit & Send", hop: "Bank :8001" },
    { key: "P2P_PEER_RESPONSE_RECEIVED", label: "04. Peer Credit ACK", hop: "Bank :8003" },
    { key: "P2P_TRANSACTION_COMPLETED", label: "05. P2P Settled", hop: "Ledger" },
  ];

  const activeMode = (activeTxn?.mode || mode || "rest").toLowerCase();
  const stepsToRender = activeMode === "p2p" ? p2pSteps : standardSteps;

  return (
    <PageShell connStatus={connStatus}>
      <div className="page-header">
        <div>
          <h1 className="page-title">UPI Transfer</h1>
          <div className="meta-inline" style={{ marginTop: 4 }}>
            <span className="font-mono" style={{ color: "var(--emerald)" }}>
              ● IMPS 24×7
            </span>
            <span className="meta-sep">·</span>
            <span className="font-mono">{mode.toUpperCase()}</span>
          </div>
        </div>

        <button
          type="button"
          className="btn-secondary"
          onClick={handleSwapAccounts}
        >
          <ArrowLeftRight size={14} />
          <span>Swap Remitter ↔ Beneficiary</span>
        </button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 18,
            padding: "10px 14px",
            background: "var(--crimson-tint)",
            border: "1px solid var(--crimson)",
            borderRadius: "var(--radius-sm)",
            color: "var(--crimson)",
            fontSize: "0.84rem",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="sandbox-split">
        {/* Left: Minimal Kinetic Composer */}
        <div className="surface-panel">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              executePayment(null);
            }}
            style={{ display: "flex", flexDirection: "column", gap: 18 }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: "var(--ink-secondary)",
                  marginBottom: 8,
                }}
              >
                From (Remitter VPA)
              </label>
              <div className="vpa-grid">
                {users.slice(0, 4).map((u) => {
                  const isSel = getUpiId(senderInput) === u.upi_id;
                  return (
                    <button
                      key={u.upi_id}
                      type="button"
                      className={`vpa-btn ${isSel ? "selected" : ""}`}
                      onClick={() => setSenderInput(u.upi_id)}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          width: "100%",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: "0.86rem" }}>{u.name}</span>
                        <span
                          className="font-mono tabular-nums"
                          style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--emerald)" }}
                        >
                          {INR_FORMAT.format(u.balance)}
                        </span>
                      </div>
                      <div className="font-mono" style={{ fontSize: "0.72rem", color: "var(--ink-muted)" }}>
                        {u.upi_id} · {u.bank_name.replace(" Bank", "")}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: "var(--ink-secondary)",
                  marginBottom: 8,
                }}
              >
                To (Beneficiary VPA)
              </label>
              <div className="vpa-grid">
                {users.slice(0, 4).map((u) => {
                  const isSel = getUpiId(receiverInput) === u.upi_id;
                  return (
                    <button
                      key={u.upi_id}
                      type="button"
                      className={`vpa-btn ${isSel ? "selected" : ""}`}
                      onClick={() => setReceiverInput(u.upi_id)}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          width: "100%",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: "0.86rem" }}>{u.name}</span>
                        <span
                          className="font-mono tabular-nums"
                          style={{ fontSize: "0.8rem", color: "var(--ink-secondary)" }}
                        >
                          {INR_FORMAT.format(u.balance)}
                        </span>
                      </div>
                      <div className="font-mono" style={{ fontSize: "0.72rem", color: "var(--ink-muted)" }}>
                        {u.upi_id} · {u.bank_name.replace(" Bank", "")}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ink-secondary)" }}>
                  Amount (₹)
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  {[100, 500, 1000, 2000, 5000].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setAmount(val)}
                      className="font-mono"
                      style={{
                        padding: "3px 8px",
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        background: Number(amount) === val ? "var(--saffron-tint)" : "var(--bg-subtle)",
                        border: "1px solid",
                        borderColor: Number(amount) === val ? "var(--saffron)" : "var(--border-hairline)",
                        borderRadius: 6,
                        cursor: "pointer",
                        color: "var(--ink-primary)",
                      }}
                    >
                      ₹{val}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="number"
                min="1"
                className="rupee-display-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    color: "var(--ink-secondary)",
                    marginBottom: 4,
                  }}
                >
                  Protocol
                </label>
                <select
                  className="field-input font-mono"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="rest">REST / HTTP</option>
                  <option value="grpc">gRPC / Protobuf</option>
                  <option value="rabbitmq">RabbitMQ AMQP</option>
                  <option value="p2p">Direct Bank P2P</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    color: "var(--ink-secondary)",
                    marginBottom: 4,
                  }}
                >
                  Idempotency Key
                </label>
                <input
                  type="text"
                  className="field-input font-mono"
                  value={idempotencyKey}
                  onChange={(e) => setIdempotencyKey(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="submit"
                className="btn-primary"
                disabled={submitting}
                style={{ flex: 1 }}
              >
                {submitting ? <RefreshCw size={16} className="spin" /> : <Send size={16} />}
                <span>
                  {submitting
                    ? "Clearing..."
                    : `Pay ${INR_FORMAT.format(Number(amount) || 0)}`}
                </span>
              </button>

              {lastUsedKey && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={submitting}
                  onClick={() => executePayment(lastUsedKey)}
                >
                  Replay Duplicate
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Right: Visual State Pipeline */}
        <div className="surface-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span className="font-mono" style={{ fontSize: "0.84rem", fontWeight: 700 }}>
              {activeTxn ? activeTxn.transactionId : "PIPELINE IDLE"}
            </span>
            {activeTxn && (
              <span
                className={`status-text ${
                  activeTxn.status === "SUCCESS"
                    ? "status-nominal"
                    : activeTxn.status === "FAILED" || activeTxn.status === "ROLLBACK_COMPLETED"
                    ? "status-critical"
                    : "status-warning"
                }`}
              >
                {activeTxn.status === "SUCCESS"
                  ? "✓ SETTLED"
                  : activeTxn.status === "FAILED"
                  ? "✕ FAILED"
                  : activeTxn.status}
              </span>
            )}
          </div>

          {activeTxn?.duplicateRequest && (
            <div
              className="font-mono"
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                background: "var(--saffron-tint)",
                border: "1px solid var(--saffron)",
                borderRadius: "var(--radius-sm)",
                color: "var(--saffron)",
                fontSize: "0.78rem",
                fontWeight: 600,
              }}
            >
              ⚡ DUPLICATE BLOCKED: {activeTxn.idempotencyKey}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stepsToRender.map((st) => {
              const events = activeTxn?.timeline || [];
              const matchedEvent = events.find(
                (e) =>
                  e.event === st.key ||
                  (st.key === "TRANSACTION_COMPLETED" &&
                    (e.event === "SUCCESS" ||
                      e.event === "TRANSACTION_COMPLETED" ||
                      e.event === "PAYMENT_SUCCESS"))
              );
              const isExecuted = Boolean(matchedEvent);

              return (
                <div
                  key={st.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "11px 14px",
                    borderRadius: "var(--radius-sm)",
                    background: isExecuted ? "var(--emerald-tint)" : "var(--bg-subtle)",
                    border: "1px solid",
                    borderColor: isExecuted ? "rgba(0, 229, 153, 0.45)" : "var(--border-hairline)",
                    transition: "all 0.25s var(--ease-spring)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <CheckCircle2
                      size={16}
                      color={isExecuted ? "var(--emerald)" : "var(--ink-muted)"}
                    />
                    <span style={{ fontSize: "0.84rem", fontWeight: 600 }}>{st.label}</span>
                  </div>
                  <span className="font-mono" style={{ fontSize: "0.72rem", color: "var(--ink-secondary)" }}>
                    {st.hop}
                  </span>
                </div>
              );
            })}
          </div>

          {activeTxn?.timeline &&
            activeTxn.timeline.some(
              (e) =>
                e.event?.includes("FAILURE") ||
                e.event?.includes("RETRY") ||
                e.event?.includes("ROLLBACK") ||
                e.event?.includes("CIRCUIT_BREAKER") ||
                activeTxn.status === "FAILED"
            ) && (
              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  background: "var(--crimson-tint)",
                  border: "1px solid var(--crimson)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <div
                  className="font-mono"
                  style={{
                    fontWeight: 700,
                    fontSize: "0.78rem",
                    color: "var(--crimson)",
                    marginBottom: 8,
                  }}
                >
                  {activeTxn.timeline.some((e) => e.event === "ROLLBACK_COMPLETED")
                    ? "↺ SAGA ROLLBACK COMPLETED"
                    : "▲ FAULT & RETRY TRACE"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {activeTxn.timeline
                    .filter(
                      (e) =>
                        e.event?.includes("FAILURE") ||
                        e.event?.includes("RETRY") ||
                        e.event?.includes("ROLLBACK") ||
                        e.event?.includes("CIRCUIT_BREAKER") ||
                        e.event?.includes("FAILED")
                    )
                    .map((e, idx) => (
                      <div
                        key={idx}
                        className="font-mono"
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "0.74rem",
                          color: "var(--ink-primary)",
                        }}
                      >
                        <span>
                          [{e.service}] {e.event}
                        </span>
                        <span style={{ color: "var(--ink-muted)" }}>
                          {new Date(e.timestamp || Date.now()).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
        </div>
      </div>
    </PageShell>
  );
}
