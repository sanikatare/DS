import { useEffect, useState, useRef, useCallback } from "react";
import PageShell from "../components/layout/PageShell";
import {
  fetchSnapshot,
  toggleFailure,
  resetSystem,
  initiateTransaction,
  connectTransactionSocket,
} from "../api";
import { RefreshCw, Send, Zap, ArrowLeftRight } from "lucide-react";

const INR_FORMAT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function NetworkView() {
  const [healthMap, setHealthMap] = useState({});
  const [stats, setStats] = useState({ total: 0, successful: 0, failed: 0, processing: 0 });
  const [users, setUsers] = useState([]);
  const [failureState, setFailureState] = useState({
    sender_bank_failure: false,
    npci_failure: false,
    receiver_bank_failure: false,
    timeout_simulation: false,
    circuit_breakers: {},
  });

  const [senderUpi, setSenderUpi] = useState("sanika@bank");
  const [receiverUpi, setReceiverUpi] = useState("navya@bank");
  const [amount, setAmount] = useState(500);
  const [mode, setMode] = useState("rest");
  const [submitting, setSubmitting] = useState(false);
  const [faultBusy, setFaultBusy] = useState(false);

  const [selectedNodeId, setSelectedNodeId] = useState("transaction-service");
  const [activeTxn, setActiveTxn] = useState(null);
  const [activeHop, setActiveHop] = useState(null);
  const [connStatus, setConnStatus] = useState("connecting");

  const stageRef = useRef(null);
  const rafRef = useRef(null);
  const refreshTimerRef = useRef(null);

  const refreshAll = useCallback(async () => {
    try {
      const snap = await fetchSnapshot();
      if (snap.health) setHealthMap(snap.health);
      if (snap.stats) setStats(snap.stats);
      if (snap.users) setUsers(snap.users);
      if (snap.failureState) setFailureState(snap.failureState);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshAll();
    }, 90);
  }, [refreshAll]);

  useEffect(() => {
    refreshAll();
    const ws = connectTransactionSocket((evt) => {
      const evName = evt.eventType || evt.event || "";
      if (evName.includes("SENDER")) setActiveHop("sender-bank");
      else if (evName.includes("NPCI")) setActiveHop("npci");
      else if (evName.includes("RECEIVER") || evName.includes("P2P_PEER")) setActiveHop("receiver-bank");
      else if (evName.includes("SUCCESS") || evName.includes("COMPLETED") || evName.includes("FAILED")) {
        setActiveHop(null);
      }

      if (evt.transactionId && evt.transactionId !== "SYS-GLOBAL") {
        setActiveTxn((prev) => ({
          ...(prev || {}),
          ...evt,
          transactionId: evt.transactionId,
          status: evt.status || prev?.status || "PROCESSING",
        }));
      }
      scheduleRefresh();
    }, setConnStatus);

    return () => {
      ws.close();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [refreshAll, scheduleRefresh]);

  // Zero-re-render 60fps hardware-accelerated 3D tilt using CSS custom properties
  function handleMouseMove(e) {
    if (!stageRef.current) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      const rx = ((0.5 - y) * 5.5).toFixed(2);
      const ry = ((x - 0.5) * 5.5).toFixed(2);
      stageRef.current.style.setProperty("--spot-x", `${Math.round(x * 100)}%`);
      stageRef.current.style.setProperty("--spot-y", `${Math.round(y * 100)}%`);
      stageRef.current.style.setProperty("--tilt-rx", `${rx}deg`);
      stageRef.current.style.setProperty("--tilt-ry", `${ry}deg`);
    });
  }

  function handleMouseLeave() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (!stageRef.current) return;
    stageRef.current.style.setProperty("--spot-x", "50%");
    stageRef.current.style.setProperty("--spot-y", "50%");
    stageRef.current.style.setProperty("--tilt-rx", "0deg");
    stageRef.current.style.setProperty("--tilt-ry", "0deg");
  }

  function handleSwapVpa() {
    setSenderUpi(receiverUpi);
    setReceiverUpi(senderUpi);
  }

  async function handleExpressTransfer(e) {
    e.preventDefault();
    if (senderUpi === receiverUpi) return;
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) return;

    setSubmitting(true);
    try {
      const res = await initiateTransaction({
        senderId: senderUpi,
        receiverId: receiverUpi,
        amount: numAmount,
        idempotencyKey: `UPI-${Date.now()}`,
        mode,
      });
      setActiveTxn(res);
      await refreshAll();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleFault(target, currentVal, e) {
    if (e) e.stopPropagation();
    setFaultBusy(true);
    try {
      const updated = await toggleFailure(target, !currentVal);
      setFailureState(updated);
      await refreshAll();
    } catch (err) {
      console.error(err);
    } finally {
      setFaultBusy(false);
    }
  }

  async function handleRestoreAll() {
    setFaultBusy(true);
    try {
      const restored = await resetSystem();
      setFailureState(restored);
      await refreshAll();
    } catch (err) {
      console.error(err);
    } finally {
      setFaultBusy(false);
    }
  }

  const nodes = [
    {
      id: "client",
      title: "PSP UPI App",
      port: ":3000",
      role: "Initiator & WebRTC Peer",
      faultKey: null,
      faultField: null,
      cbKey: null,
      nodeClass: "topology-node",
      top: "14%",
      left: "50%",
    },
    {
      id: "transaction-service",
      title: "UPI Switch Hub",
      port: ":8000",
      role: "Saga Orchestrator & WS Stream",
      faultKey: null,
      faultField: null,
      cbKey: null,
      nodeClass: "topology-node hub-node",
      top: "45%",
      left: "50%",
    },
    {
      id: "sender-bank",
      title: "Remitter Bank",
      port: ":8001",
      role: "Atomic Debit & Saga Rollback",
      faultKey: "sender-bank",
      faultField: "sender_bank_failure",
      cbKey: "sender-bank",
      nodeClass: "topology-node bank-node",
      top: "80%",
      left: "20%",
    },
    {
      id: "npci",
      title: "NPCI Clearing",
      port: ":8002",
      role: "Interbank VPA Switch",
      faultKey: "npci",
      faultField: "npci_failure",
      cbKey: "npci",
      nodeClass: "topology-node switch-node",
      top: "80%",
      left: "50%",
    },
    {
      id: "receiver-bank",
      title: "Beneficiary Bank",
      port: ":8003",
      role: "Settlement Credit Ledger",
      faultKey: "receiver-bank",
      faultField: "receiver_bank_failure",
      cbKey: "receiver-bank",
      nodeClass: "topology-node bank-node",
      top: "80%",
      left: "80%",
    },
  ];

  const currentStatus = activeTxn?.status || "IDLE";
  const isProcessing = currentStatus === "PROCESSING" || currentStatus === "INITIATED" || submitting;
  const isSuccess = currentStatus === "SUCCESS";
  const isFailed = currentStatus === "FAILED" || currentStatus === "ROLLBACK_COMPLETED";
  const isP2P = mode === "p2p" || activeTxn?.mode === "p2p";

  const hasAnyFault =
    failureState.sender_bank_failure ||
    failureState.npci_failure ||
    failureState.receiver_bank_failure ||
    failureState.timeout_simulation;

  const successRate =
    stats.total > 0 ? ((stats.successful / stats.total) * 100).toFixed(1) : "100.0";

  const orbColor = isFailed ? "#FF3B5C" : isSuccess ? "#00E599" : "#FF6B00";
  const orbSpeed = isProcessing ? "0.55s" : "2.1s";

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || nodes[1];
  const selectedNodeCb =
    selectedNode.cbKey && failureState.circuit_breakers
      ? failureState.circuit_breakers[selectedNode.cbKey]
      : null;

  return (
    <PageShell connStatus={connStatus}>
      {/* Compact Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">UPI Network Topology</h1>
          <div className="meta-inline" style={{ marginTop: 4 }}>
            <span
              className="font-mono"
              style={{ color: connStatus === "connected" ? "var(--emerald)" : "var(--saffron)" }}
            >
              {connStatus === "connected" ? "● LIVE STREAM" : "○ CONNECTING"}
            </span>
            <span className="meta-sep">·</span>
            <span className="font-mono">{mode.toUpperCase()}</span>
            {activeHop && (
              <>
                <span className="meta-sep">·</span>
                <span className="font-mono" style={{ color: "var(--saffron)" }}>
                  ACTIVE HOP: {activeHop.toUpperCase()}
                </span>
              </>
            )}
          </div>
        </div>

        {hasAnyFault && (
          <button
            type="button"
            className="btn-secondary"
            onClick={handleRestoreAll}
            disabled={faultBusy}
          >
            <RefreshCw size={14} />
            <span>Reset Faults</span>
          </button>
        )}
      </div>

      {/* KPI Strip */}
      <div className="kpi-strip">
        <div className="kpi-cell">
          <span className="kpi-label">Transactions</span>
          <span className="kpi-value">{stats.total}</span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Settled</span>
          <span className="kpi-value" style={{ color: "var(--emerald)" }}>
            {stats.successful}
          </span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Rollbacks / Failed</span>
          <span
            className="kpi-value"
            style={{ color: stats.failed > 0 ? "var(--crimson)" : "var(--ink-primary)" }}
          >
            {stats.failed}
          </span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Success Rate</span>
          <span className="kpi-value">{successRate}%</span>
        </div>
      </div>

      {/* Main Two-Zone Kinetic Sandbox */}
      <div className="sandbox-split">
        {/* Left: Interactive 3D Topology Stage + Selected Node Inspector + VPA Strip */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            ref={stageRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="topology-stage"
          >
            <svg className="topology-svg" viewBox="0 0 800 520" preserveAspectRatio="none">
              <defs>
                <filter id="orb-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                <path id="path-client-hub" d="M 400 72 C 400 150, 400 155, 400 234" />
                <path id="path-hub-sender" d="M 400 234 C 400 325, 160 315, 160 416" />
                <path id="path-hub-npci" d="M 400 234 C 400 325, 400 325, 400 416" />
                <path id="path-hub-receiver" d="M 400 234 C 400 325, 640 315, 640 416" />
                <path id="path-p2p-direct" d="M 160 416 C 300 490, 500 490, 640 416" />
              </defs>

              {/* Ambient Sonic Ripple Rings around Central Hub */}
              <circle cx="400" cy="234" r="42" fill="none" stroke={orbColor} strokeWidth="1" opacity="0.35">
                <animate
                  attributeName="r"
                  values="35;95"
                  dur={isProcessing ? "1.0s" : "2.8s"}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.45;0"
                  dur={isProcessing ? "1.0s" : "2.8s"}
                  repeatCount="indefinite"
                />
              </circle>
              <circle cx="400" cy="234" r="42" fill="none" stroke={orbColor} strokeWidth="1" opacity="0.2">
                <animate
                  attributeName="r"
                  values="35;125"
                  dur={isProcessing ? "1.0s" : "2.8s"}
                  begin="0.5s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.3;0"
                  dur={isProcessing ? "1.0s" : "2.8s"}
                  begin="0.5s"
                  repeatCount="indefinite"
                />
              </circle>

              {/* Base Structural Bezier Tracks */}
              <use href="#path-client-hub" className="wire-base" />
              <use href="#path-hub-sender" className="wire-base" />
              <use href="#path-hub-npci" className="wire-base" style={{ opacity: isP2P ? 0.2 : 1 }} />
              <use href="#path-hub-receiver" className="wire-base" />
              {isP2P && <use href="#path-p2p-direct" className="wire-base" />}

              {/* Animated Energy Streams */}
              <use
                href="#path-client-hub"
                className={`wire-stream ${
                  isProcessing ? "active" : isFailed ? "fault" : isSuccess ? "settled" : ""
                }`}
              />
              <use
                href="#path-hub-sender"
                className={`wire-stream ${
                  failureState.sender_bank_failure
                    ? "fault"
                    : activeHop === "sender-bank" || isProcessing
                    ? "active"
                    : isSuccess
                    ? "settled"
                    : ""
                }`}
              />
              {!isP2P && (
                <use
                  href="#path-hub-npci"
                  className={`wire-stream ${
                    failureState.npci_failure
                      ? "fault"
                      : activeHop === "npci" || isProcessing
                      ? "active"
                      : isSuccess
                      ? "settled"
                      : ""
                  }`}
                />
              )}
              <use
                href="#path-hub-receiver"
                className={`wire-stream ${
                  failureState.receiver_bank_failure
                    ? "fault"
                    : activeHop === "receiver-bank" || isProcessing
                    ? "active"
                    : isSuccess
                    ? "settled"
                    : ""
                }`}
              />
              {isP2P && (
                <use
                  href="#path-p2p-direct"
                  className={`wire-stream ${isProcessing ? "active" : "settled"}`}
                />
              )}

              {/* High-Velocity Glowing Signal Orbs travelling along Bezier curves */}
              <circle r="5" fill={orbColor} filter="url(#orb-glow)">
                <animateMotion dur={orbSpeed} repeatCount="indefinite">
                  <mpath href="#path-client-hub" />
                </animateMotion>
              </circle>

              <circle
                r="5"
                fill={failureState.sender_bank_failure ? "#FF3B5C" : orbColor}
                filter="url(#orb-glow)"
              >
                <animateMotion dur={orbSpeed} begin="0.2s" repeatCount="indefinite">
                  <mpath href="#path-hub-sender" />
                </animateMotion>
              </circle>

              {!isP2P && (
                <circle
                  r="5"
                  fill={failureState.npci_failure ? "#FF3B5C" : orbColor}
                  filter="url(#orb-glow)"
                >
                  <animateMotion dur={orbSpeed} begin="0.4s" repeatCount="indefinite">
                    <mpath href="#path-hub-npci" />
                  </animateMotion>
                </circle>
              )}

              <circle
                r="5"
                fill={failureState.receiver_bank_failure ? "#FF3B5C" : orbColor}
                filter="url(#orb-glow)"
              >
                <animateMotion dur={orbSpeed} begin="0.6s" repeatCount="indefinite">
                  <mpath href="#path-hub-receiver" />
                </animateMotion>
              </circle>

              {isP2P && (
                <circle r="6" fill="#00E599" filter="url(#orb-glow)">
                  <animateMotion dur="0.85s" repeatCount="indefinite">
                    <mpath href="#path-p2p-direct" />
                  </animateMotion>
                </circle>
              )}
            </svg>

            {/* Interactive Spatial Nodes */}
            {nodes.map((node) => {
              const isNodeFaulted = node.faultField ? Boolean(failureState[node.faultField]) : false;
              const health = healthMap[node.id]?.status || "healthy";
              const isSelected = selectedNodeId === node.id;
              const isHopActive = activeHop === node.id;

              return (
                <div
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`${node.nodeClass} ${isSelected ? "selected" : ""} ${
                    isNodeFaulted ? "faulted" : ""
                  } ${(node.id === "transaction-service" && isProcessing) || isHopActive ? "pulsing" : ""}`}
                  style={{ top: node.top, left: node.left }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--ink-primary)" }}>
                      {node.title}
                    </span>
                    <span className="font-mono" style={{ fontSize: "0.72rem", color: "var(--saffron)" }}>
                      {node.port}
                    </span>
                  </div>

                  <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span
                      className={`status-text ${
                        isNodeFaulted || health !== "healthy" ? "status-critical" : "status-nominal"
                      }`}
                    >
                      {isNodeFaulted ? "▲ FAULT" : "● ONLINE"}
                    </span>

                    {node.faultKey && (
                      <button
                        type="button"
                        disabled={faultBusy}
                        onClick={(e) => handleToggleFault(node.faultKey, isNodeFaulted, e)}
                        className="font-mono"
                        style={{
                          padding: "3px 8px",
                          fontSize: "0.68rem",
                          fontWeight: 700,
                          borderRadius: 4,
                          border: "1px solid",
                          borderColor: isNodeFaulted ? "var(--crimson)" : "var(--border-strong)",
                          background: isNodeFaulted ? "var(--crimson)" : "rgba(255,255,255,0.05)",
                          color: "#FFFFFF",
                          cursor: "pointer",
                        }}
                      >
                        {isNodeFaulted ? "Restore" : "Trip"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selected Node Live Inspector Bar */}
          <div
            className="surface-panel"
            style={{
              padding: "12px 18px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{selectedNode.title}</span>
              <span className="font-mono" style={{ fontSize: "0.75rem", color: "var(--saffron)" }}>
                {selectedNode.port}
              </span>
              <span className="meta-sep">·</span>
              <span style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>
                {selectedNode.role}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {selectedNodeCb && (
                <span className="font-mono" style={{ fontSize: "0.76rem", color: "var(--ink-secondary)" }}>
                  Breaker:{" "}
                  <strong
                    style={{
                      color:
                        selectedNodeCb.state === "OPEN"
                          ? "var(--crimson)"
                          : selectedNodeCb.state === "HALF_OPEN"
                          ? "var(--saffron)"
                          : "var(--emerald)",
                    }}
                  >
                    {selectedNodeCb.state}
                  </strong>{" "}
                  ({selectedNodeCb.failureCount}/{selectedNodeCb.failureThreshold})
                </span>
              )}

              {selectedNode.faultKey && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ minHeight: 32, padding: "4px 12px", fontSize: "0.75rem" }}
                  disabled={faultBusy}
                  onClick={() =>
                    handleToggleFault(
                      selectedNode.faultKey,
                      Boolean(failureState[selectedNode.faultField])
                    )
                  }
                >
                  <Zap size={12} />
                  <span>
                    {failureState[selectedNode.faultField] ? "Restore Node" : "Inject Outage"}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Minimal VPA Account Balances Strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {users.slice(0, 4).map((u) => {
              const isSender = senderUpi === u.upi_id;
              const isReceiver = receiverUpi === u.upi_id;
              return (
                <button
                  key={u.upi_id}
                  type="button"
                  onClick={() => {
                    if (!isSender && !isReceiver) setSenderUpi(u.upi_id);
                    else if (isSender) setReceiverUpi(u.upi_id);
                  }}
                  className={`vpa-btn ${isSender ? "selected" : ""}`}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.86rem" }}>{u.name}</span>
                    <span className="font-mono" style={{ fontSize: "0.68rem", color: "var(--ink-secondary)" }}>
                      {u.bank_name.replace(" Bank", "")}
                    </span>
                  </div>
                  <div
                    className="font-mono tabular-nums"
                    style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--emerald)", marginTop: 2 }}
                  >
                    {INR_FORMAT.format(u.balance)}
                  </div>
                  <div className="font-mono" style={{ fontSize: "0.7rem", color: "var(--ink-muted)" }}>
                    {u.upi_id}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Minimal Express Pay & Chaos Triggers */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="surface-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 className="font-display" style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                Instant UPI Pulse
              </h2>
              <button
                type="button"
                onClick={handleSwapVpa}
                className="btn-secondary"
                style={{ minHeight: 30, padding: "4px 10px", fontSize: "0.72rem" }}
                title="Swap Remitter and Beneficiary"
              >
                <ArrowLeftRight size={12} />
                <span>Swap VPA</span>
              </button>
            </div>

            <form onSubmit={handleExpressTransfer} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
                    From VPA
                  </label>
                  <select
                    className="field-input font-mono"
                    value={senderUpi}
                    onChange={(e) => setSenderUpi(e.target.value)}
                  >
                    {users.map((u) => (
                      <option key={u.upi_id} value={u.upi_id}>
                        {u.name} ({INR_FORMAT.format(u.balance)})
                      </option>
                    ))}
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
                    To VPA
                  </label>
                  <select
                    className="field-input font-mono"
                    value={receiverUpi}
                    onChange={(e) => setReceiverUpi(e.target.value)}
                  >
                    {users.map((u) => (
                      <option key={u.upi_id} value={u.upi_id}>
                        {u.name} ({u.bank_name.replace(" Bank", "")})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--ink-secondary)" }}>
                    Amount (₹)
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[100, 500, 1000, 2500].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAmount(preset)}
                        className="font-mono"
                        style={{
                          padding: "3px 8px",
                          fontSize: "0.72rem",
                          background: Number(amount) === preset ? "var(--saffron-tint)" : "var(--bg-subtle)",
                          border: "1px solid",
                          borderColor: Number(amount) === preset ? "var(--saffron)" : "var(--border-hairline)",
                          borderRadius: 6,
                          cursor: "pointer",
                          color: "var(--ink-primary)",
                        }}
                      >
                        ₹{preset}
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

              <div
                className="segmented-group"
                style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}
              >
                {[
                  { id: "rest", label: "REST" },
                  { id: "grpc", label: "gRPC" },
                  { id: "rabbitmq", label: "AMQP" },
                  { id: "p2p", label: "P2P" },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`segmented-btn ${mode === p.id ? "active" : ""}`}
                    onClick={() => setMode(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? <RefreshCw size={16} className="spin" /> : <Send size={16} />}
                <span>{submitting ? "Routing Pulse..." : `Send ₹${amount}`}</span>
              </button>
            </form>
          </div>

          {/* Compact Chaos Switch Grid */}
          <div className="surface-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span className="font-display" style={{ fontSize: "0.95rem", fontWeight: 700 }}>
                Chaos Switches
              </span>
              <Zap size={15} color="var(--saffron)" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { key: "sender-bank", field: "sender_bank_failure", label: "Remitter :8001" },
                { key: "npci", field: "npci_failure", label: "NPCI :8002" },
                { key: "receiver-bank", field: "receiver_bank_failure", label: "Beneficiary :8003" },
                { key: "timeout", field: "timeout_simulation", label: "5s Latency" },
              ].map((item) => {
                const active = Boolean(failureState[item.field]);
                return (
                  <button
                    key={item.key}
                    type="button"
                    disabled={faultBusy}
                    onClick={() => handleToggleFault(item.key, active)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 12px",
                      background: active ? "var(--crimson-tint)" : "var(--bg-subtle)",
                      border: "1px solid",
                      borderColor: active ? "var(--crimson)" : "var(--border-hairline)",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      transition: "all 0.18s var(--ease-spring)",
                    }}
                  >
                    <span className="font-mono" style={{ fontSize: "0.76rem", fontWeight: 600 }}>
                      {item.label}
                    </span>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: active ? "var(--crimson)" : "var(--emerald)",
                      }}
                    >
                      {active ? "FAULT" : "OK"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Telemetry Badge */}
          {activeTxn && (
            <div
              className="surface-panel"
              style={{
                borderColor:
                  activeTxn.status === "SUCCESS"
                    ? "rgba(0, 229, 153, 0.4)"
                    : activeTxn.status === "FAILED"
                    ? "rgba(255, 59, 92, 0.4)"
                    : "var(--border-hairline)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="font-mono" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                  {activeTxn.transactionId}
                </span>
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
                    ? "✕ ROLLED BACK"
                    : activeTxn.status}
                </span>
              </div>
              {activeTxn.amount && (
                <div className="meta-inline font-mono" style={{ marginTop: 6 }}>
                  <span style={{ color: "var(--ink-primary)", fontWeight: 700 }}>
                    {INR_FORMAT.format(activeTxn.amount)}
                  </span>
                  <span className="meta-sep">·</span>
                  <span>
                    {activeTxn.senderId} → {activeTxn.receiverId}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
