import { useEffect, useState, useCallback } from "react";
import PageShell from "../components/layout/PageShell";
import {
  fetchFailureStatus,
  toggleFailure,
  resetSystem,
  initiateTransaction,
  connectTransactionSocket,
} from "../api";
import { RefreshCw, Send, Zap } from "lucide-react";

export default function ChaosView() {
  const [status, setStatus] = useState({
    sender_bank_failure: false,
    npci_failure: false,
    receiver_bank_failure: false,
    timeout_simulation: false,
    circuit_breakers: {},
  });
  const [busy, setBusy] = useState(false);
  const [testingTxn, setTestingTxn] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [connStatus, setConnStatus] = useState("connecting");

  const loadStatus = useCallback(async () => {
    try {
      const data = await fetchFailureStatus();
      setStatus(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const ws = connectTransactionSocket((evt) => {
      const evName = evt.eventType || evt.event || "";
      if (
        evName.includes("CIRCUIT_BREAKER") ||
        evName.includes("FAILURE") ||
        evName.includes("RESTORED") ||
        evName.includes("ROLLBACK")
      ) {
        loadStatus();
      }
    }, setConnStatus);
    return () => ws.close();
  }, [loadStatus]);

  async function handleToggle(target, enable) {
    setBusy(true);
    try {
      const data = await toggleFailure(target, enable);
      setStatus(data);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetAll() {
    setBusy(true);
    try {
      const data = await resetSystem();
      setStatus(data);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleRunFaultTest() {
    setTestingTxn(true);
    try {
      const res = await initiateTransaction({
        senderId: "sanika@bank",
        receiverId: "navya@bank",
        amount: 300,
        idempotencyKey: `FAULT-${Date.now()}`,
        mode: "rest",
      });
      setTestResult(res);
      await loadStatus();
    } catch (err) {
      console.error(err);
    } finally {
      setTestingTxn(false);
    }
  }

  const faultNodes = [
    {
      key: "sender-bank",
      field: "sender_bank_failure",
      name: "Remitter Bank",
      port: ":8001",
      tag: "HTTP 503 Outage",
    },
    {
      key: "npci",
      field: "npci_failure",
      name: "NPCI Switch",
      port: ":8002",
      tag: "Saga Rollback",
    },
    {
      key: "receiver-bank",
      field: "receiver_bank_failure",
      name: "Beneficiary Bank",
      port: ":8003",
      tag: "Saga Rollback",
    },
    {
      key: "timeout",
      field: "timeout_simulation",
      name: "5.0s Network Lag",
      port: "ALL",
      tag: "> 3.0s Timeout",
    },
  ];

  const cbMap = status.circuit_breakers || {};

  return (
    <PageShell connStatus={connStatus}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Faults & Circuit Breakers</h1>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleResetAll}
            disabled={busy}
          >
            <RefreshCw size={14} />
            <span>Reset All</span>
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleRunFaultTest}
            disabled={testingTxn}
          >
            {testingTxn ? <RefreshCw size={15} className="spin" /> : <Send size={15} />}
            <span>{testingTxn ? "Testing..." : "Fire ₹300 Test Pulse"}</span>
          </button>
        </div>
      </div>

      {/* 3-State Circuit Breaker Strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
        {[
          { key: "sender-bank", label: "Remitter Breaker (:8001)" },
          { key: "npci", label: "NPCI Breaker (:8002)" },
          { key: "receiver-bank", label: "Beneficiary Breaker (:8003)" },
        ].map((item) => {
          const cb = cbMap[item.key] || {
            state: "CLOSED",
            failureCount: 0,
            failureThreshold: 3,
          };
          const isClosed = cb.state === "CLOSED";
          const isOpen = cb.state === "OPEN";

          return (
            <div
              key={item.key}
              className="surface-panel"
              style={{
                borderColor: isClosed
                  ? "var(--border-hairline)"
                  : isOpen
                  ? "var(--crimson)"
                  : "var(--saffron)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>{item.label}</span>
                <span
                  className={`status-text ${
                    isClosed
                      ? "status-nominal"
                      : isOpen
                      ? "status-critical"
                      : "status-warning"
                  }`}
                >
                  {isClosed ? "● CLOSED" : isOpen ? "▲ OPEN" : "◐ HALF_OPEN"}
                </span>
              </div>
              <div
                className="font-mono tabular-nums"
                style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", marginTop: 10 }}
              >
                Failures: {cb.failureCount} / {cb.failureThreshold}
              </div>
            </div>
          );
        })}
      </div>

      {/* 4 Interactive Fault Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 22 }}>
        {faultNodes.map((n) => {
          const isFailed = Boolean(status[n.field]);

          return (
            <div
              key={n.key}
              className="surface-panel"
              style={{
                borderColor: isFailed ? "var(--crimson)" : "var(--border-hairline)",
                background: isFailed ? "var(--crimson-tint)" : "var(--bg-surface)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 18,
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="font-mono" style={{ fontSize: "0.74rem", color: "var(--saffron)" }}>
                    {n.port}
                  </span>
                  <span className={`status-text ${isFailed ? "status-critical" : "status-nominal"}`}>
                    {isFailed ? "▲ FAULT" : "● OK"}
                  </span>
                </div>
                <h3 className="font-display" style={{ fontSize: "1.05rem", fontWeight: 700, marginTop: 8 }}>
                  {n.name}
                </h3>
                <div
                  className="font-mono"
                  style={{ fontSize: "0.74rem", color: "var(--ink-secondary)", marginTop: 4 }}
                >
                  {n.tag}
                </div>
              </div>

              <button
                type="button"
                className={isFailed ? "btn-secondary" : "btn-primary"}
                style={{
                  width: "100%",
                  background: isFailed ? "rgba(255,255,255,0.08)" : "var(--crimson)",
                  borderColor: "var(--crimson)",
                }}
                onClick={() => handleToggle(n.key, !isFailed)}
                disabled={busy}
              >
                <Zap size={14} />
                <span>{isFailed ? "Restore" : "Trip Node"}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Live Fault Execution Trace */}
      {testResult && (
        <div className="surface-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span className="font-mono" style={{ fontWeight: 700, fontSize: "0.86rem" }}>
              {testResult.transactionId}
            </span>
            <span
              className={`status-text ${
                testResult.status === "SUCCESS" ? "status-nominal" : "status-critical"
              }`}
            >
              {testResult.status === "SUCCESS" ? "✓ SETTLED" : `✕ ${testResult.status}`}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(testResult.timeline || []).map((ev, i) => (
              <div
                key={i}
                className="font-mono"
                style={{
                  display: "grid",
                  gridTemplateColumns: "190px 220px 1fr 100px",
                  gap: 12,
                  padding: "8px 12px",
                  background: "var(--bg-subtle)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.76rem",
                }}
              >
                <span style={{ fontWeight: 600 }}>{ev.service}</span>
                <span style={{ color: "var(--saffron)" }}>{ev.event}</span>
                <span style={{ color: "var(--ink-secondary)" }}>{ev.message}</span>
                <span style={{ textAlign: "right", color: "var(--ink-muted)" }}>
                  {new Date(ev.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}
