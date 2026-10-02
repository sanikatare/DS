import { useEffect, useState, useCallback } from "react";
import PageShell from "../components/layout/PageShell";
import {
  fetchClocks,
  syncClocks,
  introduceClockDrift,
  resetClocks,
  fetchLamportClocks,
  triggerLamportEvent,
  resetLamportClocks,
  fetchVectorClocks,
  triggerVectorEvent,
  compareVectors,
  resetVectorClocks,
  fetchGlobalState,
  captureGlobalState,
  fetchBeacons,
  pulseBeacon,
  fetchArchitecture,
  connectTransactionSocket,
} from "../api";
import {
  Clock,
  GitCommit,
  Layers,
  Activity,
  Network,
  RefreshCw,
  Zap,
  Camera,
  ArrowRight,
  ShieldCheck,
  Radio,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";

export default function SynchronizationView() {
  const [activeTab, setActiveTab] = useState("clocks");
  const [connStatus, setConnStatus] = useState("connecting");

  // 1. Clock Synchronization State
  const [clocks, setClocks] = useState([]);
  const [clockSyncResult, setClockSyncResult] = useState(null);
  const [clockBusy, setClockBusy] = useState(false);

  // 2. Lamport Clock State
  const [lamportNodes, setLamportNodes] = useState([]);
  const [lamportHistory, setLamportHistory] = useState([]);
  const [lamportBusy, setLamportBusy] = useState(false);

  // 3. Vector Clock State
  const [vectorNodes, setVectorNodes] = useState([]);
  const [vectorHistory, setVectorHistory] = useState([]);
  const [vectorBusy, setVectorBusy] = useState(false);
  const [vectorCompareA, setVectorCompareA] = useState("[1, 2, 0, 0]");
  const [vectorCompareB, setVectorCompareB] = useState("[0, 1, 0, 0]");
  const [compareResult, setCompareResult] = useState(null);

  // 4. Global State State
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotBusy, setSnapshotBusy] = useState(false);

  // 5. Beacon Protocol State
  const [beacons, setBeacons] = useState([]);

  // 6. Distributed Web Systems Architecture State
  const [archData, setArchData] = useState(null);

  // Data Loading
  const loadClocks = useCallback(async () => {
    try {
      const res = await fetchClocks();
      setClocks(res.clocks || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadLamport = useCallback(async () => {
    try {
      const res = await fetchLamportClocks();
      setLamportNodes(res.clocks || []);
      setLamportHistory(res.history || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadVector = useCallback(async () => {
    try {
      const res = await fetchVectorClocks();
      setVectorNodes(res.vectors || []);
      setVectorHistory(res.history || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadGlobalState = useCallback(async () => {
    try {
      const res = await fetchGlobalState();
      setSnapshots(res.snapshots || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadBeacons = useCallback(async () => {
    try {
      const res = await fetchBeacons();
      setBeacons(res.beacons || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadArch = useCallback(async () => {
    try {
      const res = await fetchArchitecture();
      setArchData(res);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadClocks();
    loadLamport();
    loadVector();
    loadGlobalState();
    loadBeacons();
    loadArch();

    // Auto-poll physical clocks & beacons every 1.5s for live visual ticking
    const interval = setInterval(() => {
      loadClocks();
      loadBeacons();
    }, 1500);

    const ws = connectTransactionSocket((evt) => {
      const evName = evt.eventType || evt.event || "";
      if (evName.includes("LAMPORT") || evName.includes("TRANSACTION") || evName.includes("SENDER") || evName.includes("NPCI") || evName.includes("RECEIVER")) {
        loadLamport();
        loadVector();
      }
      if (evName.includes("GLOBAL_STATE")) {
        loadGlobalState();
      }
      if (evName.includes("BEACONS")) {
        loadBeacons();
      }
      if (evName.includes("CLOCK")) {
        loadClocks();
      }
    }, setConnStatus);

    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [loadClocks, loadLamport, loadVector, loadGlobalState, loadBeacons, loadArch]);

  // Handlers
  async function handleSyncClocks() {
    setClockBusy(true);
    try {
      const res = await syncClocks();
      setClockSyncResult(res);
      await loadClocks();
    } catch (e) {
      console.error(e);
    } finally {
      setClockBusy(false);
    }
  }

  async function handleIntroduceDrift(nodeId, driftMs) {
    try {
      await introduceClockDrift(nodeId, driftMs);
      await loadClocks();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleResetClocks() {
    try {
      await resetClocks();
      setClockSyncResult(null);
      await loadClocks();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleTriggerLamport(type, fromNode, toNode, description) {
    setLamportBusy(true);
    try {
      await triggerLamportEvent({ type, fromNode, toNode, description });
      await loadLamport();
    } catch (e) {
      console.error(e);
    } finally {
      setLamportBusy(false);
    }
  }

  async function handleResetLamport() {
    try {
      await resetLamportClocks();
      await loadLamport();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleTriggerVector(type, fromNode, toNode, description) {
    setVectorBusy(true);
    try {
      await triggerVectorEvent({ type, fromNode, toNode, description });
      await loadVector();
    } catch (e) {
      console.error(e);
    } finally {
      setVectorBusy(false);
    }
  }

  async function handleCompareVectors() {
    try {
      const vA = JSON.parse(vectorCompareA);
      const vB = JSON.parse(vectorCompareB);
      const res = await compareVectors(vA, vB);
      setCompareResult(res);
    } catch (err) {
      setCompareResult({
        relation: "ERROR",
        explanation: "Invalid vector JSON format. Please use format like [1, 2, 0, 0]",
      });
    }
  }

  async function handleResetVector() {
    try {
      await resetVectorClocks();
      await loadVector();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleCaptureGlobalState() {
    setSnapshotBusy(true);
    try {
      await captureGlobalState();
      await loadGlobalState();
    } catch (e) {
      console.error(e);
    } finally {
      setSnapshotBusy(false);
    }
  }

  async function handleManualBeaconPulse(nodeId) {
    try {
      await pulseBeacon(nodeId);
      await loadBeacons();
    } catch (e) {
      console.error(e);
    }
  }

  const tabs = [
    { id: "clocks", label: "Clock Sync", icon: Clock, unit: "Unit III" },
    { id: "lamport", label: "Lamport Clocks", icon: GitCommit, unit: "Unit III" },
    { id: "vector", label: "Vector Clocks", icon: Layers, unit: "Unit III" },
    { id: "globalState", label: "Global State", icon: Camera, unit: "Unit III" },
    { id: "beacon", label: "Beacon Monitor", icon: Radio, unit: "Unit III" },
    { id: "webSystems", label: "Distributed Web", icon: Network, unit: "Unit IV" },
  ];

  return (
    <PageShell connStatus={connStatus}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Distributed Systems Synchronization</h1>
          <div className="meta-inline" style={{ marginTop: 4 }}>
            <span className="font-mono" style={{ color: "var(--emerald)" }}>
              ● SYLLABUS UNITS III & IV
            </span>
            <span className="meta-sep">·</span>
            <span>Educational Simulator</span>
            <span className="meta-sep">·</span>
            <span className="font-mono" style={{ color: "var(--saffron)" }}>
              4 DISTRIBUTED NODES
            </span>
          </div>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div
        className="segmented-group"
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          marginBottom: 20,
        }}
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={`segmented-btn ${isActive ? "active" : ""}`}
              onClick={() => setActiveTab(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "10px 12px",
              }}
            >
              <Icon size={15} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* =================================================================== */}
      {/* TAB 1: CLOCK SYNCHRONIZATION                                       */}
      {/* =================================================================== */}
      {activeTab === "clocks" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Educational Concept Banner */}
          <div
            className="surface-panel"
            style={{
              borderLeft: "3px solid var(--saffron)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 20,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Clock size={16} color="var(--saffron)" />
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700 }}>
                  Physical Clock Synchronization in Distributed Systems (Berkeley Consensus)
                </h3>
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", maxWidth: 900 }}>
                In an asynchronous distributed payment network, physical hardware crystal clocks on independent bank servers drift at different rates. Without synchronization, financial logs, timeout detectors, and audit trails cannot agree on chronological time. The Berkeley algorithm coordinates nodes, polls their local clocks, averages the skews, and sends adjustment deltas so all 4 nodes converge.
              </p>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSyncClocks}
                disabled={clockBusy}
              >
                {clockBusy ? <RefreshCw size={14} className="spin" /> : <ShieldCheck size={14} />}
                <span>Synchronize Clocks</span>
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleResetClocks}
              >
                Reset Skews
              </button>
            </div>
          </div>

          {/* Consensus Result Banner */}
          {clockSyncResult && (
            <div
              style={{
                padding: "12px 18px",
                background: "var(--emerald-tint)",
                border: "1px solid var(--emerald)",
                borderRadius: "var(--radius-sm)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <CheckCircle2 size={18} color="var(--emerald)" />
                <span style={{ fontSize: "0.86rem", fontWeight: 600 }}>
                  {clockSyncResult.message}
                </span>
              </div>
              <span className="font-mono tabular-nums" style={{ fontSize: "0.8rem", color: "var(--emerald)", fontWeight: 700 }}>
                Consensus Skew: {clockSyncResult.consensusOffsetMs} ms
              </span>
            </div>
          )}

          {/* 4 Simulated Node Clock Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            {clocks.map((c) => {
              const isSync = c.status === "SYNCHRONIZED";
              const isDrifting = c.status === "DRIFTING";
              return (
                <div
                  key={c.id}
                  className="surface-panel"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    borderColor: isSync ? "rgba(0, 229, 153, 0.45)" : isDrifting ? "var(--saffron)" : "rgba(255, 59, 92, 0.45)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="font-mono" style={{ fontSize: "0.72rem", color: "var(--saffron)" }}>
                      :{c.port}
                    </span>
                    <span
                      className={`status-text ${
                        isSync ? "status-nominal" : isDrifting ? "status-warning" : "status-critical"
                      }`}
                    >
                      {c.status}
                    </span>
                  </div>

                  <div>
                    <h4 style={{ fontSize: "0.92rem", fontWeight: 700 }}>{c.name}</h4>
                    <div
                      className="font-mono tabular-nums"
                      style={{
                        fontSize: "1.5rem",
                        fontWeight: 800,
                        marginTop: 6,
                        color: "var(--ink-primary)",
                      }}
                    >
                      {c.currentTimeFormatted}
                    </div>
                  </div>

                  <div style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem" }}>
                      <span style={{ color: "var(--ink-secondary)" }}>Base Drift:</span>
                      <span className="font-mono">{c.baseOffsetMs > 0 ? `+${c.baseOffsetMs}` : c.baseOffsetMs} ms</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem", marginTop: 4 }}>
                      <span style={{ color: "var(--ink-secondary)" }}>Sync Adjustment:</span>
                      <span className="font-mono" style={{ color: "var(--emerald)" }}>
                        {c.adjustedOffsetMs > 0 ? `+${c.adjustedOffsetMs}` : c.adjustedOffsetMs} ms
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem", marginTop: 4, fontWeight: 700 }}>
                      <span style={{ color: "var(--ink-primary)" }}>Effective Skew:</span>
                      <span className="font-mono" style={{ color: Math.abs(c.effectiveOffsetMs) < 10 ? "var(--emerald)" : "var(--crimson)" }}>
                        {c.effectiveOffsetMs > 0 ? `+${c.effectiveOffsetMs}` : c.effectiveOffsetMs} ms
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: "0.7rem", padding: "4px 8px", minHeight: 28 }}
                      onClick={() => handleIntroduceDrift(c.id, 1000)}
                      title="Add +1.0s clock drift for viva demonstration"
                    >
                      +1.0s Skew
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: "0.7rem", padding: "4px 8px", minHeight: 28 }}
                      onClick={() => handleIntroduceDrift(c.id, -1000)}
                      title="Add -1.0s clock drift for viva demonstration"
                    >
                      -1.0s Skew
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: LAMPORT'S LOGICAL CLOCK ALGORITHM                           */}
      {/* =================================================================== */}
      {activeTab === "lamport" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Concept Banner */}
          <div
            className="surface-panel"
            style={{
              borderLeft: "3px solid var(--emerald)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 20,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <GitCommit size={16} color="var(--emerald)" />
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700 }}>
                  Lamport's Logical Clock Algorithm (Scalar Clock Partial Ordering)
                </h3>
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", maxWidth: 900 }}>
                Leslie Lamport proved that physical time cannot define causal ordering across distributed systems without synchrony. Instead, each node maintains a scalar counter <strong style={{ color: "var(--ink-primary)" }}>L</strong>.
                Rule 1 (Local): <span className="font-mono">L = L + 1</span>.
                Rule 2 (Send): <span className="font-mono">L = L + 1</span> (attached to message).
                Rule 3 (Receive message with timestamp T): <span className="font-mono">L = max(L, T) + 1</span>.
                This guarantees: if <span className="font-mono">A → B</span> then <span className="font-mono">L(A) &lt; L(B)</span>.
              </p>
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={handleResetLamport}
            >
              Reset Clocks (L=0)
            </button>
          </div>

          {/* Current Lamport Clocks on 4 Nodes */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            {lamportNodes.map((n) => (
              <div key={n.id} className="surface-panel">
                <span className="font-mono" style={{ fontSize: "0.72rem", color: "var(--ink-secondary)" }}>
                  NODE: {n.id.toUpperCase()}
                </span>
                <h4 style={{ fontSize: "0.92rem", fontWeight: 700, marginTop: 2 }}>{n.name}</h4>
                <div
                  className="font-mono tabular-nums"
                  style={{
                    fontSize: "2rem",
                    fontWeight: 800,
                    color: "var(--saffron)",
                    marginTop: 6,
                  }}
                >
                  L = {n.clock}
                </div>
                <div style={{ fontSize: "0.74rem", color: "var(--ink-muted)", marginTop: 4 }}>
                  Last: {n.lastEvent}
                </div>
              </div>
            ))}
          </div>

          {/* Interactive Viva Step-by-Step Trigger Bar */}
          <div className="surface-panel">
            <h4 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 12 }}>
              Interactive Viva Demonstration Triggers
            </h4>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={lamportBusy}
                onClick={() =>
                  handleTriggerLamport("LOCAL", "transaction-service", null, "Local validation event")
                }
              >
                <span>Local Event on Hub (L = L + 1)</span>
              </button>

              <button
                type="button"
                className="btn-secondary"
                disabled={lamportBusy}
                onClick={() =>
                  handleTriggerLamport("SEND", "transaction-service", "sender-bank", "Debit intent sent")
                }
              >
                <span>Send Hub → Sender Bank (Attach L)</span>
              </button>

              <button
                type="button"
                className="btn-secondary"
                disabled={lamportBusy}
                onClick={() =>
                  handleTriggerLamport("RECEIVE", "sender-bank", "transaction-service", "Debit request received")
                }
              >
                <span>Receive at Sender Bank (max(L, T) + 1)</span>
              </button>

              <button
                type="button"
                className="btn-secondary"
                disabled={lamportBusy}
                onClick={() =>
                  handleTriggerLamport("SEND", "npci", "receiver-bank", "Routing payload sent")
                }
              >
                <span>Send NPCI → Receiver Bank</span>
              </button>

              <button
                type="button"
                className="btn-secondary"
                disabled={lamportBusy}
                onClick={() =>
                  handleTriggerLamport("RECEIVE", "receiver-bank", "npci", "Routing instruction received")
                }
              >
                <span>Receive at Receiver Bank</span>
              </button>
            </div>
          </div>

          {/* Lamport Event History Log */}
          <div className="surface-panel" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-hairline)", fontWeight: 700, fontSize: "0.86rem" }}>
              Lamport Event Sequence Log
            </div>
            {lamportHistory.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--ink-muted)", fontSize: "0.82rem" }}>
                No events recorded yet. Run a UPI transfer or trigger a manual step above!
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Node</th>
                    <th>Lamport Clock</th>
                    <th>Event Description</th>
                    <th style={{ textAlign: "right" }}>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {lamportHistory.map((h) => (
                    <tr key={h.id}>
                      <td>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: 4,
                            background:
                              h.eventType === "LOCAL"
                                ? "rgba(255, 107, 0, 0.12)"
                                : h.eventType === "SEND"
                                ? "rgba(0, 229, 153, 0.12)"
                                : "rgba(56, 189, 248, 0.12)",
                            color:
                              h.eventType === "LOCAL"
                                ? "var(--saffron)"
                                : h.eventType === "SEND"
                                ? "var(--emerald)"
                                : "#38BDF8",
                          }}
                        >
                          {h.eventType}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{h.nodeId}</td>
                      <td className="font-mono tabular-nums" style={{ fontWeight: 700, color: "var(--emerald)" }}>
                        {h.clockBefore} → {h.clockAfter}
                      </td>
                      <td style={{ fontSize: "0.8rem", color: "var(--ink-secondary)" }}>{h.description}</td>
                      <td className="font-mono" style={{ textAlign: "right", fontSize: "0.74rem", color: "var(--ink-muted)" }}>
                        {new Date(h.timestamp).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: VECTOR CLOCK ALGORITHM                                       */}
      {/* =================================================================== */}
      {activeTab === "vector" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Concept Banner */}
          <div
            className="surface-panel"
            style={{
              borderLeft: "3px solid #38BDF8",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 20,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Layers size={16} color="#38BDF8" />
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700 }}>
                  Vector Clock Algorithm (Detecting Causality & Concurrent Events)
                </h3>
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", maxWidth: 900 }}>
                While Lamport clocks guarantee <span className="font-mono">A → B ⇒ L(A) &lt; L(B)</span>, they cannot detect whether two events are causally independent (concurrent).
                Vector Clocks overcome this: with 4 nodes, each node maintains an integer array <strong style={{ color: "var(--ink-primary)" }}>[Sender, Transaction, NPCI, Receiver]</strong>.
                Local: <span className="font-mono">V_k[k] = V_k[k] + 1</span>.
                Send: Increment local component and attach copy of vector.
                Receive vector W: <span className="font-mono">V_k[j] = max(V_k[j], W[j])</span>, then <span className="font-mono">V_k[k] = V_k[k] + 1</span>.
              </p>
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={handleResetVector}
            >
              Reset Vectors [0,0,0,0]
            </button>
          </div>

          {/* 4 Node Vector Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            {vectorNodes.map((n, idx) => (
              <div key={n.id} className="surface-panel">
                <span className="font-mono" style={{ fontSize: "0.72rem", color: "var(--ink-secondary)" }}>
                  INDEX {idx}: {n.id.toUpperCase()}
                </span>
                <h4 style={{ fontSize: "0.92rem", fontWeight: 700, marginTop: 2 }}>{n.name}</h4>
                <div
                  className="font-mono tabular-nums"
                  style={{
                    fontSize: "1.45rem",
                    fontWeight: 800,
                    color: "#38BDF8",
                    marginTop: 6,
                  }}
                >
                  [{n.vector.join(", ")}]
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--ink-muted)", marginTop: 4 }}>
                  [Sender, Txn, NPCI, Receiver]
                </div>
              </div>
            ))}
          </div>

          {/* Interactive Causality & Concurrency Evaluator */}
          <div className="surface-panel">
            <h4 style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: 8 }}>
              Interactive Happens-Before & Concurrency Checker
            </h4>
            <p style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", marginBottom: 12 }}>
              Enter any two 4-element vectors to evaluate their causal relationship (<span className="font-mono">A → B</span>, <span className="font-mono">B → A</span>, or <span className="font-mono">A ∥ B Concurrent</span>):
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "end" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 600, color: "var(--ink-secondary)", marginBottom: 4 }}>
                  Vector A [Sender, Txn, NPCI, Receiver]
                </label>
                <input
                  type="text"
                  className="field-input font-mono"
                  value={vectorCompareA}
                  onChange={(e) => setVectorCompareA(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 600, color: "var(--ink-secondary)", marginBottom: 4 }}>
                  Vector B [Sender, Txn, NPCI, Receiver]
                </label>
                <input
                  type="text"
                  className="field-input font-mono"
                  value={vectorCompareB}
                  onChange={(e) => setVectorCompareB(e.target.value)}
                />
              </div>

              <button
                type="button"
                className="btn-primary"
                onClick={handleCompareVectors}
              >
                <span>Evaluate Causality</span>
              </button>
            </div>

            {compareResult && (
              <div
                style={{
                  marginTop: 14,
                  padding: "12px 16px",
                  background:
                    compareResult.relation === "CONCURRENT"
                      ? "var(--saffron-tint)"
                      : compareResult.relation.includes("HAPPENS")
                      ? "var(--emerald-tint)"
                      : "var(--bg-subtle)",
                  border: "1px solid",
                  borderColor:
                    compareResult.relation === "CONCURRENT"
                      ? "var(--saffron)"
                      : compareResult.relation.includes("HAPPENS")
                      ? "var(--emerald)"
                      : "var(--border-hairline)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    className="font-mono"
                    style={{
                      fontWeight: 800,
                      fontSize: "0.88rem",
                      color:
                        compareResult.relation === "CONCURRENT"
                          ? "var(--saffron)"
                          : compareResult.relation.includes("HAPPENS")
                          ? "var(--emerald)"
                          : "var(--ink-primary)",
                    }}
                  >
                    {compareResult.relation}
                  </span>
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--ink-primary)", marginTop: 4 }}>
                  {compareResult.explanation}
                </div>
              </div>
            )}
          </div>

          {/* Vector Clock Event Log */}
          <div className="surface-panel" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-hairline)", fontWeight: 700, fontSize: "0.86rem" }}>
              Vector Clock Mutation History
            </div>
            {vectorHistory.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--ink-muted)", fontSize: "0.82rem" }}>
                No vector clock events recorded yet. Run a UPI transfer to see vectors evolve!
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Node</th>
                    <th>Vector Transformation</th>
                    <th>Description</th>
                    <th style={{ textAlign: "right" }}>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {vectorHistory.map((h) => (
                    <tr key={h.id}>
                      <td>
                        <span className="font-mono" style={{ fontSize: "0.72rem", fontWeight: 700 }}>
                          {h.eventType}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{h.nodeId}</td>
                      <td className="font-mono tabular-nums" style={{ color: "#38BDF8", fontWeight: 700 }}>
                        [{h.vectorBefore.join(",")}] → [{h.vectorAfter.join(",")}]
                      </td>
                      <td style={{ fontSize: "0.8rem", color: "var(--ink-secondary)" }}>{h.description}</td>
                      <td className="font-mono" style={{ textAlign: "right", fontSize: "0.74rem", color: "var(--ink-muted)" }}>
                        {new Date(h.timestamp).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 4: GLOBAL STATE SNAPSHOT                                        */}
      {/* =================================================================== */}
      {activeTab === "globalState" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Concept Banner */}
          <div
            className="surface-panel"
            style={{
              borderLeft: "3px solid #A855F7",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 20,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Camera size={16} color="#A855F7" />
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700 }}>
                  Global State in Distributed Systems (Chandy-Lamport Consistent Cut)
                </h3>
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", maxWidth: 900 }}>
                Because a distributed system lacks shared memory and a common global clock, there is no single instantaneous observer. A <strong style={{ color: "var(--ink-primary)" }}>Global State</strong> consists of:
                (1) the local states of all 4 participating distributed nodes, plus
                (2) the states of all communication channels (in-flight messages).
                A snapshot cut is <strong style={{ color: "var(--emerald)" }}>consistent</strong> if no message is recorded as received unless its sending event is also included in the cut.
              </p>
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={handleCaptureGlobalState}
              disabled={snapshotBusy}
            >
              {snapshotBusy ? <RefreshCw size={14} className="spin" /> : <Camera size={14} />}
              <span>Capture Global State</span>
            </button>
          </div>

          {/* Snapshots Display */}
          {snapshots.length === 0 ? (
            <div className="surface-panel" style={{ padding: 48, textAlign: "center" }}>
              <Camera size={32} color="var(--ink-muted)" style={{ margin: "0 auto 12px" }} />
              <h4 style={{ fontWeight: 700, marginBottom: 6 }}>No Global Snapshot Captured Yet</h4>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", marginBottom: 16 }}>
                Click "Capture Global State" to take an atomic snapshot across all 4 nodes and message channels.
              </p>
              <button type="button" className="btn-primary" onClick={handleCaptureGlobalState}>
                Capture Initial Global State
              </button>
            </div>
          ) : (
            snapshots.map((snap) => (
              <div key={snap.snapshotId} className="surface-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="font-mono" style={{ fontWeight: 800, fontSize: "0.96rem" }}>
                      {snap.snapshotId}
                    </span>
                    <span className="font-mono" style={{ fontSize: "0.76rem", color: "var(--saffron)" }}>
                      L={snap.lamportTime} · V=[{snap.vectorTime.join(", ")}]
                    </span>
                  </div>
                  <span className="status-text status-nominal">
                    ● CONSISTENT SNAPSHOT CUT
                  </span>
                </div>

                {/* 4 Node States Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                  <div style={{ padding: 12, background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--ink-secondary)", fontWeight: 600 }}>SENDER BANK NODE</div>
                    <div className="font-mono" style={{ fontSize: "0.86rem", fontWeight: 700, color: "var(--emerald)", marginTop: 4 }}>
                      State: {snap.nodeStates.senderBank.state}
                    </div>
                    <div className="font-mono tabular-nums" style={{ fontSize: "0.76rem", marginTop: 4 }}>
                      Balance: ₹{snap.nodeStates.senderBank.balance}
                    </div>
                  </div>

                  <div style={{ padding: 12, background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--ink-secondary)", fontWeight: 600 }}>TRANSACTION SERVICE (HUB)</div>
                    <div className="font-mono" style={{ fontSize: "0.86rem", fontWeight: 700, color: "var(--saffron)", marginTop: 4 }}>
                      State: {snap.nodeStates.transactionService.state}
                    </div>
                    <div style={{ fontSize: "0.76rem", color: "var(--ink-muted)", marginTop: 4 }}>
                      {snap.nodeStates.transactionService.lastAction}
                    </div>
                  </div>

                  <div style={{ padding: 12, background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--ink-secondary)", fontWeight: 600 }}>NPCI SIMULATOR NODE</div>
                    <div className="font-mono" style={{ fontSize: "0.86rem", fontWeight: 700, color: "#38BDF8", marginTop: 4 }}>
                      State: {snap.nodeStates.npci.state}
                    </div>
                    <div style={{ fontSize: "0.76rem", color: "var(--ink-muted)", marginTop: 4 }}>
                      Routing queue: {snap.nodeStates.npci.routingQueue}
                    </div>
                  </div>

                  <div style={{ padding: 12, background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--ink-secondary)", fontWeight: 600 }}>RECEIVER BANK NODE</div>
                    <div className="font-mono" style={{ fontSize: "0.86rem", fontWeight: 700, color: "var(--emerald)", marginTop: 4 }}>
                      State: {snap.nodeStates.receiverBank.state}
                    </div>
                    <div className="font-mono tabular-nums" style={{ fontSize: "0.76rem", marginTop: 4 }}>
                      Ledger: ₹{snap.nodeStates.receiverBank.creditsRecorded}
                    </div>
                  </div>
                </div>

                {/* Channel States */}
                <div>
                  <div style={{ fontSize: "0.76rem", fontWeight: 700, color: "var(--ink-secondary)", marginBottom: 6 }}>
                    COMMUNICATION CHANNEL STATES (IN-FLIGHT MESSAGES)
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                    <div className="font-mono" style={{ padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 6, fontSize: "0.74rem", border: "1px solid var(--border-hairline)" }}>
                      Hub → Sender: {snap.channelStates.hubToSender.inFlight ? <span style={{ color: "var(--saffron)" }}>IN-FLIGHT</span> : <span style={{ color: "var(--emerald)" }}>EMPTY</span>}
                    </div>
                    <div className="font-mono" style={{ padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 6, fontSize: "0.74rem", border: "1px solid var(--border-hairline)" }}>
                      Hub → NPCI: {snap.channelStates.hubToNpci.inFlight ? <span style={{ color: "var(--saffron)" }}>IN-FLIGHT</span> : <span style={{ color: "var(--emerald)" }}>EMPTY</span>}
                    </div>
                    <div className="font-mono" style={{ padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 6, fontSize: "0.74rem", border: "1px solid var(--border-hairline)" }}>
                      NPCI → Receiver: {snap.channelStates.npciToReceiver.inFlight ? <span style={{ color: "var(--saffron)" }}>IN-FLIGHT</span> : <span style={{ color: "var(--emerald)" }}>EMPTY</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 5: BEACON PROTOCOL (FAILURE DETECTOR)                           */}
      {/* =================================================================== */}
      {activeTab === "beacon" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Concept Banner */}
          <div
            className="surface-panel"
            style={{
              borderLeft: "3px solid var(--crimson)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 20,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Radio size={16} color="var(--crimson)" />
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700 }}>
                  Beacon Protocol: Heartbeat-Based Failure Detection
                </h3>
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", maxWidth: 900 }}>
                In an asynchronous network, a node crash is indistinguishable from arbitrary message delay without heartbeats. Under the Beacon Protocol, each service broadcasts a periodic beacon every <strong style={{ color: "var(--ink-primary)" }}>2.0 seconds</strong>. If a node fails to beacon within <strong style={{ color: "var(--saffron)" }}>5.0 seconds</strong>, it is flagged as <strong style={{ color: "var(--crimson)" }}>UNREACHABLE</strong>.
                Tripping any node on the <strong style={{ color: "var(--ink-primary)" }}>Faults (Chaos)</strong> page suppresses its beacon immediately!
              </p>
            </div>
          </div>

          {/* 4 Beacon Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            {beacons.map((b) => {
              const isHealthy = b.status === "HEALTHY";
              const isRecovered = b.status === "RECOVERED";
              const isUnreachable = b.status === "UNREACHABLE";
              return (
                <div
                  key={b.id}
                  className="surface-panel"
                  style={{
                    borderColor: isUnreachable
                      ? "var(--crimson)"
                      : isHealthy || isRecovered
                      ? "rgba(0, 229, 153, 0.45)"
                      : "var(--saffron)",
                    background: isUnreachable ? "var(--crimson-tint)" : "var(--bg-surface)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="font-mono" style={{ fontSize: "0.72rem", color: "var(--saffron)" }}>
                      :{b.port}
                    </span>
                    <span
                      className={`status-text ${
                        isHealthy || isRecovered
                          ? "status-nominal"
                          : isUnreachable
                          ? "status-critical"
                          : "status-warning"
                      }`}
                    >
                      {b.status === "HEALTHY"
                        ? "● HEALTHY"
                        : b.status === "RECOVERED"
                        ? "✓ RECOVERED"
                        : "▲ UNREACHABLE"}
                    </span>
                  </div>

                  <h4 style={{ fontSize: "0.92rem", fontWeight: 700, marginTop: 8 }}>{b.name}</h4>

                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4, fontSize: "0.76rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--ink-secondary)" }}>Beacon Sequence:</span>
                      <span className="font-mono tabular-nums">#{b.sequence}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--ink-secondary)" }}>Beacon Interval:</span>
                      <span className="font-mono">2.0s</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--ink-secondary)" }}>Timeout Threshold:</span>
                      <span className="font-mono">5.0s</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--ink-secondary)" }}>Last Beacon:</span>
                      <span className="font-mono" style={{ color: isUnreachable ? "var(--crimson)" : "var(--ink-primary)" }}>
                        {new Date(b.lastBeaconTime).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ width: "100%", marginTop: 12, fontSize: "0.74rem", minHeight: 32 }}
                    onClick={() => handleManualBeaconPulse(b.id)}
                  >
                    <Radio size={12} />
                    <span>Send Manual Beacon Pulse</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 6: UNIT IV DISTRIBUTED WEB-BASED SYSTEMS ARCHITECTURE           */}
      {/* =================================================================== */}
      {activeTab === "webSystems" && archData && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Unit IV Academic Header */}
          <div
            className="surface-panel"
            style={{
              borderLeft: "3px solid var(--saffron)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Network size={16} color="var(--saffron)" />
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700 }}>
                  {archData.topic} — {archData.systemType}
                </h3>
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", maxWidth: 950 }}>
                A <strong style={{ color: "var(--ink-primary)" }}>Distributed Web-Based System</strong> leverages open web standards (HTTP/1.1, HTTP/2, WebSockets, WebRTC) to coordinate decoupled microservices across network boundaries. This project models an asynchronous, multi-tiered payment processing engine structured according to classical distributed systems architectural principles.
              </p>
            </div>
          </div>

          {/* 4 Architectural Tiers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
            {archData.tiers.map((tier, idx) => (
              <div key={idx} className="surface-panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="font-mono" style={{ fontSize: "0.74rem", color: "var(--saffron)", fontWeight: 700 }}>
                    TIER {idx + 1}
                  </span>
                  <span className="font-mono" style={{ fontSize: "0.72rem", color: "var(--ink-muted)" }}>
                    {tier.protocols.join(" · ")}
                  </span>
                </div>

                <h4 style={{ fontSize: "0.96rem", fontWeight: 700 }}>{tier.tier}</h4>

                <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>
                  <strong style={{ color: "var(--ink-primary)" }}>Components: </strong>
                  {tier.components.join(", ")}
                </div>

                <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>
                  <strong style={{ color: "var(--ink-primary)" }}>Responsibilities: </strong>
                  {tier.responsibility}
                </div>
              </div>
            ))}
          </div>

          {/* Transaction Workflow Execution Sequence */}
          <div className="surface-panel">
            <h4 style={{ fontSize: "0.92rem", fontWeight: 700, marginBottom: 12 }}>
              End-to-End Distributed Web Transaction Protocol Workflow
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {archData.communicationFlow.map((step, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "8px 12px",
                    background: "var(--bg-subtle)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-hairline)",
                    fontSize: "0.8rem",
                    color: "var(--ink-primary)",
                  }}
                >
                  {step}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
