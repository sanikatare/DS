import { useEffect, useState } from "react";
import PageShell from "../components/layout/PageShell";
import { fetchFailureStatus, toggleFailure, resetSystem } from "../api";
import { Zap, RefreshCw, AlertTriangle, ShieldCheck, Clock, Server } from "lucide-react";
import "../styles.css";

export default function ChaosView() {
  const [status, setStatus] = useState({
    sender_bank_failure: false,
    npci_failure: false,
    receiver_bank_failure: false,
    timeout_simulation: false,
  });
  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    try {
      const data = await fetchFailureStatus();
      setStatus(data);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleToggle(target, enable) {
    setBusy(true);
    try {
      const data = await toggleFailure(target, enable);
      setStatus(data);
    } catch (err) {
      alert("Failed to toggle fault injection: " + err.message);
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
      alert("Failed to reset fault injection targets.");
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickScenario(scenario) {
    setBusy(true);
    try {
      await resetSystem();
      if (scenario === "sender") {
        const data = await toggleFailure("sender-bank", true);
        setStatus(data);
      } else if (scenario === "receiver") {
        const data = await toggleFailure("receiver-bank", true);
        setStatus(data);
      } else if (scenario === "npci") {
        const data = await toggleFailure("npci", true);
        setStatus(data);
      } else if (scenario === "timeout") {
        const data = await toggleFailure("timeout", true);
        setStatus(data);
      } else {
        const data = await fetchFailureStatus();
        setStatus(data);
      }
    } catch (err) {
      alert("Failed to execute quick scenario: " + err.message);
    } finally {
      setBusy(false);
    }
  }

  const nodes = [
    { key: "sender-bank", field: "sender_bank_failure", name: "SENDER BANK SERVICE", port: ":8001", role: "Simulates HTTP 503 Service Unavailable on sender debit" },
    { key: "npci", field: "npci_failure", name: "NPCI SWITCH SIMULATOR", port: ":8002", role: "Simulates interbank routing switch failure" },
    { key: "receiver-bank", field: "receiver_bank_failure", name: "RECEIVER BANK SERVICE", port: ":8003", role: "Simulates beneficiary credit failure & triggers sender debit rollback" },
    { key: "timeout", field: "timeout_simulation", name: "NETWORK TIMEOUT SIMULATION", port: "ALL ENDPOINTS", role: "Injects 5.0s delay exceeding 3.0s client timeout threshold" },
  ];

  return (
    <PageShell>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">FAULT LAB</h1>
          <p className="page-subtitle">Resilience, retries & compensating rollbacks</p>
        </div>

        <button
          className="dock-item"
          style={{ border: "1px solid var(--border)", background: "#ffffff", padding: "6px 14px" }}
          onClick={handleResetAll}
          disabled={busy}
        >
          <RefreshCw size={14} /> Restore All Services
        </button>
      </div>

      {/* Preset Scenario Quick Controls */}
      <div className="ui-card" style={{ padding: 18, marginBottom: 24 }}>
        <div style={{ fontSize: "0.74rem", fontWeight: 800, color: "var(--muted)", letterSpacing: "0.05em", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={14} color="var(--orange-primary)" />
          <span>FAULT SCENARIO PRESETS</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button
            className="dock-item"
            style={{ background: !status.sender_bank_failure && !status.npci_failure && !status.receiver_bank_failure && !status.timeout_simulation ? "var(--green-light)" : "rgba(44, 45, 47, 0.04)", border: "1px solid var(--green-success)", color: "var(--green-success)", fontWeight: 800, fontSize: "0.78rem", padding: "6px 14px" }}
            onClick={() => handleQuickScenario("normal")}
            disabled={busy}
          >
            <ShieldCheck size={14} /> Normal Flow
          </button>

          <button
            className="dock-item"
            style={{ background: status.sender_bank_failure ? "var(--danger-light)" : "rgba(44, 45, 47, 0.04)", border: "1px solid var(--border)", color: status.sender_bank_failure ? "var(--danger)" : "var(--graphite)", fontWeight: 800, fontSize: "0.78rem", padding: "6px 14px" }}
            onClick={() => handleQuickScenario("sender")}
            disabled={busy}
          >
            <Server size={14} /> Sender Bank Failure
          </button>

          <button
            className="dock-item"
            style={{ background: status.receiver_bank_failure ? "var(--danger-light)" : "rgba(44, 45, 47, 0.04)", border: "1px solid var(--border)", color: status.receiver_bank_failure ? "var(--danger)" : "var(--graphite)", fontWeight: 800, fontSize: "0.78rem", padding: "6px 14px" }}
            onClick={() => handleQuickScenario("receiver")}
            disabled={busy}
          >
            <Server size={14} /> Receiver Bank Failure
          </button>

          <button
            className="dock-item"
            style={{ background: status.npci_failure ? "var(--danger-light)" : "rgba(44, 45, 47, 0.04)", border: "1px solid var(--border)", color: status.npci_failure ? "var(--danger)" : "var(--graphite)", fontWeight: 800, fontSize: "0.78rem", padding: "6px 14px" }}
            onClick={() => handleQuickScenario("npci")}
            disabled={busy}
          >
            <Server size={14} /> NPCI Switch Failure
          </button>

          <button
            className="dock-item"
            style={{ background: status.timeout_simulation ? "var(--danger-light)" : "rgba(44, 45, 47, 0.04)", border: "1px solid var(--border)", color: status.timeout_simulation ? "var(--danger)" : "var(--graphite)", fontWeight: 800, fontSize: "0.78rem", padding: "6px 14px" }}
            onClick={() => handleQuickScenario("timeout")}
            disabled={busy}
          >
            <Clock size={14} /> Network Delay (Timeout)
          </button>
        </div>
      </div>

      {/* Fault Injection Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 24, marginBottom: 32 }}>
        {nodes.map((n) => {
          const isFailed = status[n.field];

          return (
            <div
              key={n.key}
              style={{
                background: isFailed ? "var(--danger-light)" : "#ffffff",
                border: "2px solid",
                borderColor: isFailed ? "var(--danger)" : "var(--border)",
                borderRadius: "16px",
                padding: 24,
                transition: "all 0.25s var(--ease-smooth)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <h3 style={{ fontSize: "1.05rem", fontWeight: 900 }}>{n.name}</h3>
                  <span className="font-mono" style={{ fontSize: "0.78rem", color: "var(--orange-primary)", fontWeight: 800 }}>
                    {n.port}
                  </span>
                </div>
                <span className={`badge-status ${isFailed ? "FAILED" : "SUCCESS"}`}>
                  {isFailed ? "DISRUPTED" : "OPERATIONAL"}
                </span>
              </div>

              <p style={{ fontSize: "0.82rem", color: "var(--graphite-secondary)", marginBottom: 20 }}>
                {n.role}
              </p>

              <button
                className="btn-trigger-signal"
                style={{
                  background: isFailed ? "#ffffff" : "var(--danger)",
                  color: isFailed ? "var(--graphite)" : "#ffffff",
                  border: isFailed ? "1.5px solid var(--graphite)" : "none",
                  padding: "12px",
                  fontSize: "0.85rem",
                }}
                onClick={() => handleToggle(n.key, !isFailed)}
                disabled={busy}
              >
                <Zap size={16} />
                <span>{isFailed ? "RESTORE SERVICE" : "INJECT FAULT"}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Recovery Sequence Step Timeline */}
      <div style={{ background: "#ffffff", border: "1.5px solid var(--border)", borderRadius: "16px", padding: 28 }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 800, marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <AlertTriangle size={18} color="var(--orange-primary)" />
          FAULT TOLERANCE RECOVERY SEQUENCE
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
          {[
            "01 SERVICE_FAILURE_DETECTED",
            "02 TIMEOUT THRESHOLD (3.0s)",
            "03 RETRY_ATTEMPT (1/2)",
            "04 ROLLBACK_INITIATED",
            "05 ROLLBACK_COMPLETED / ROLLBACK_FAILED",
            "06 TRANSACTION_FAILED",
          ].map((step, idx) => (
            <div
              key={idx}
              style={{
                padding: "10px 12px",
                background: "rgba(44, 45, 47, 0.03)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.74rem",
                fontWeight: 800,
                color: "var(--graphite)",
                textAlign: "center",
              }}
            >
              {step}
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}

