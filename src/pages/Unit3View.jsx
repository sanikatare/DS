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
  runBullyElection,
  runRingElection,
  requestMutexLock,
  releaseMutexLock,
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
  Award,
  Lock,
  Play,
  RotateCcw,
} from "lucide-react";

export default function Unit3View() {
  const [activeTab, setActiveTab] = useState("clocks");
  const [connStatus, setConnStatus] = useState("connecting");

  // 1. Clock Synchronization
  const [clocks, setClocks] = useState([]);
  const [clockSyncResult, setClockSyncResult] = useState(null);
  const [clockBusy, setClockBusy] = useState(false);

  // 2. Lamport Clocks
  const [lamportNodes, setLamportNodes] = useState([]);
  const [lamportHistory, setLamportHistory] = useState([]);
  const [lamportBusy, setLamportBusy] = useState(false);

  // 3. Vector Clocks
  const [vectorNodes, setVectorNodes] = useState([]);
  const [vectorHistory, setVectorHistory] = useState([]);
  const [vectorBusy, setVectorBusy] = useState(false);
  const [vectorCompareA, setVectorCompareA] = useState("[1, 2, 0, 0]");
  const [vectorCompareB, setVectorCompareB] = useState("[0, 1, 0, 0]");
  const [compareResult, setCompareResult] = useState(null);

  // 4. Global State
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotBusy, setSnapshotBusy] = useState(false);

  // 5. Beacons
  const [beacons, setBeacons] = useState([]);

  // 6. Elections
  const [electionResult, setElectionResult] = useState(null);
  const [electionBusy, setElectionBusy] = useState(false);
  const [crashedNode, setCrashedNode] = useState("receiver-bank");
  const [initiatorNode, setInitiatorNode] = useState("sender-bank");

  // 7. Mutual Exclusion
  const [mutexResult, setMutexResult] = useState(null);
  const [mutexBusy, setMutexBusy] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [clkRes, lmpRes, vecRes, snapRes, bcnRes] = await Promise.all([
        fetchClocks(),
        fetchLamportClocks(),
        fetchVectorClocks(),
        fetchGlobalState(),
        fetchBeacons(),
      ]);
      setClocks(clkRes.clocks || []);
      setLamportNodes(lmpRes.clocks || []);
      setLamportHistory(lmpRes.history || []);
      setVectorNodes(vecRes.vectors || []);
      setVectorHistory(vecRes.history || []);
      setSnapshots(snapRes.snapshots || []);
      setBeacons(bcnRes.beacons || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadAll();
    const interval = setInterval(() => {
      fetchClocks().then((res) => setClocks(res.clocks || [])).catch(() => {});
      fetchBeacons().then((res) => setBeacons(res.beacons || [])).catch(() => {});
    }, 1500);

    const ws = connectTransactionSocket(() => loadAll(), setConnStatus);

    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [loadAll]);

  // Handlers
  async function handleSyncClocks() {
    setClockBusy(true);
    try {
      const res = await syncClocks();
      setClockSyncResult(res);
      const clk = await fetchClocks();
      setClocks(clk.clocks || []);
    } catch (e) {
      console.error(e);
    } finally {
      setClockBusy(false);
    }
  }

  async function handleDrift(nodeId, ms) {
    try {
      await introduceClockDrift(nodeId, ms);
      const clk = await fetchClocks();
      setClocks(clk.clocks || []);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleResetClocks() {
    try {
      await resetClocks();
      setClockSyncResult(null);
      const clk = await fetchClocks();
      setClocks(clk.clocks || []);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleTriggerLamport(type, fromNode, toNode, desc) {
    setLamportBusy(true);
    try {
      await triggerLamportEvent({ type, fromNode, toNode, description: desc });
      const res = await fetchLamportClocks();
      setLamportNodes(res.clocks || []);
      setLamportHistory(res.history || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLamportBusy(false);
    }
  }

  async function handleTriggerVector(type, fromNode, toNode, desc) {
    setVectorBusy(true);
    try {
      await triggerVectorEvent({ type, fromNode, toNode, description: desc });
      const res = await fetchVectorClocks();
      setVectorNodes(res.vectors || []);
      setVectorHistory(res.history || []);
    } catch (e) {
      console.error(e);
    } finally {
      setVectorBusy(false);
    }
  }

  async function handleCompareVectors() {
    try {
      const vecA = JSON.parse(vectorCompareA);
      const vecB = JSON.parse(vectorCompareB);
      const res = await compareVectors(vecA, vecB);
      setCompareResult(res);
    } catch {
      setCompareResult({ error: "Invalid vector JSON format. Expected [n1, n2, n3, n4]" });
    }
  }

  async function handleCaptureSnapshot() {
    setSnapshotBusy(true);
    try {
      await captureGlobalState();
      const res = await fetchGlobalState();
      setSnapshots(res.snapshots || []);
    } catch (e) {
      console.error(e);
    } finally {
      setSnapshotBusy(false);
    }
  }

  async function handleRunElection(algorithm) {
    setElectionBusy(true);
    try {
      const res = algorithm === "Bully"
        ? await runBullyElection(initiatorNode, crashedNode)
        : await runRingElection(initiatorNode, crashedNode);
      setElectionResult(res);
    } catch (e) {
      console.error(e);
    } finally {
      setElectionBusy(false);
    }
  }

  async function handleMutexRequest(algo) {
    setMutexBusy(true);
    try {
      const res = await requestMutexLock("sender-bank", algo);
      setMutexResult(res);
    } catch (e) {
      console.error(e);
    } finally {
      setMutexBusy(false);
    }
  }

  async function handleMutexRelease() {
    try {
      await releaseMutexLock("sender-bank");
      setMutexResult((prev) => prev ? { ...prev, granted: false, trace: [...prev.trace, { step: prev.trace.length + 1, event: "RELEASED", detail: "Mutex lock released." }] } : null);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <PageShell connStatus={connStatus}>
      {/* Unit Header */}
      <div className="page-header">
        <div>
          <div className="unit-tag">Unit III — Synchronization & Consensus</div>
          <h1 className="page-title">Distributed Synchronization & Algorithms</h1>
          <p className="page-subtitle">
            Physical Clocks (Berkeley Consensus), Lamport's Algorithm, Vector Clocks, Chandy-Lamport Snapshots, Beacons, Bully/Ring Elections & Mutual Exclusion.
          </p>
        </div>

        {/* Sub-tab Navigation */}
        <div className="segmented-pills">
          <button
            type="button"
            className={`seg-pill ${activeTab === "clocks" ? "active" : ""}`}
            onClick={() => setActiveTab("clocks")}
          >
            Physical Clocks
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "lamport" ? "active" : ""}`}
            onClick={() => setActiveTab("lamport")}
          >
            Lamport Clocks
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "vector" ? "active" : ""}`}
            onClick={() => setActiveTab("vector")}
          >
            Vector Clocks
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "global" ? "active" : ""}`}
            onClick={() => setActiveTab("global")}
          >
            Global State
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "beacons" ? "active" : ""}`}
            onClick={() => setActiveTab("beacons")}
          >
            Beacon Protocol
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "elections" ? "active" : ""}`}
            onClick={() => setActiveTab("elections")}
          >
            Elections
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "mutex" ? "active" : ""}`}
            onClick={() => setActiveTab("mutex")}
          >
            Mutex & Self Study
          </button>
        </div>
      </div>

      {/* 1. CLOCK SYNCHRONIZATION */}
      {activeTab === "clocks" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Clock size={18} style={{ color: "var(--upi-orange)" }} />
                Physical Clock Synchronization (Berkeley Algorithm Simulation)
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSyncClocks}
                  disabled={clockBusy}
                >
                  <RefreshCw size={14} className={clockBusy ? "spin" : ""} />
                  Synchronize Clocks (Berkeley Consensus)
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleResetClocks}
                >
                  <RotateCcw size={14} />
                  Reset Clocks
                </button>
              </div>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              In a distributed system, physical hardware clocks drift due to quartz oscillator imperfections. The <strong>Berkeley Algorithm</strong> is an internal clock synchronization technique where an active time server polls nodes, computes an adjusted average offset, and commands each node to advance or slow its clock into convergence.
            </p>

            {clockSyncResult && (
              <div className="status-pill success" style={{ marginBottom: "16px", padding: "8px 14px", borderRadius: "8px", width: "100%", justifyContent: "flex-start" }}>
                <CheckCircle2 size={16} />
                {clockSyncResult.message} Consensus Offset: <strong>{clockSyncResult.consensusOffsetMs}ms</strong>
              </div>
            )}

            <div className="nodes-grid">
              {clocks.map((node) => (
                <div key={node.id} className="node-card">
                  <div className="node-card-header">
                    <span className="node-name">{node.name}</span>
                    <span className={`status-pill ${node.status === "SYNCHRONIZED" ? "success" : "warning"}`}>
                      {node.status}
                    </span>
                  </div>

                  <div style={{ textAlign: "center", margin: "10px 0" }}>
                    <div style={{ fontSize: "1.75rem", fontWeight: 900, color: "var(--ink-primary)" }}>
                      {node.currentTimeFormatted}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--ink-muted)", marginTop: "4px" }}>
                      Offset: <strong>{node.effectiveOffsetMs > 0 ? `+${node.effectiveOffsetMs}` : node.effectiveOffsetMs}ms</strong>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "6px", marginTop: "auto" }}>
                    <button
                      type="button"
                      className="seg-pill"
                      style={{ flex: 1, border: "1px solid var(--border-hairline)" }}
                      onClick={() => handleDrift(node.id, 1500)}
                    >
                      +1.5s Drift
                    </button>
                    <button
                      type="button"
                      className="seg-pill"
                      style={{ flex: 1, border: "1px solid var(--border-hairline)" }}
                      onClick={() => handleDrift(node.id, -2000)}
                    >
                      -2.0s Drift
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 2. LAMPORT CLOCKS */}
      {activeTab === "lamport" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <GitCommit size={18} style={{ color: "var(--upi-green)" }} />
                Lamport's Logical Clock Algorithm
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={resetLamportClocks}
              >
                <RotateCcw size={14} />
                Reset Clocks
              </button>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              Leslie Lamport showed that absolute physical time is unnecessary to order distributed events. Lamport's algorithm assigns a monotonically increasing integer <strong>L</strong> ensuring that if event A happens-before event B (A → B), then <strong>L(A) &lt; L(B)</strong>.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "18px" }}>
              {lamportNodes.map((n) => (
                <div key={n.nodeId} style={{ padding: "14px", border: "1px solid var(--border-hairline)", borderRadius: "8px", background: "#FFFFFF", textAlign: "center" }}>
                  <div style={{ fontSize: "0.78rem", color: "var(--ink-muted)", textTransform: "uppercase" }}>{n.name}</div>
                  <div style={{ fontSize: "1.9rem", fontWeight: 900, color: "var(--upi-orange)", margin: "4px 0" }}>
                    L = {n.clock}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--ink-secondary)" }}>Events: {n.eventsProcessed}</div>
                </div>
              ))}
            </div>

            {/* Event Trigger Actions */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "18px" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleTriggerLamport("LOCAL", "transaction-service", null, "Validate User Pin")}
                disabled={lamportBusy}
              >
                Local Event (Txn Service): L = L + 1
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleTriggerLamport("SEND", "transaction-service", "sender-bank", "Send Debit Request")}
                disabled={lamportBusy}
              >
                Send Event (Txn -&gt; Sender): Attach L_msg
              </button>
              <button
                type="button"
                className="btn-green"
                onClick={() => handleTriggerLamport("RECEIVE", "sender-bank", "transaction-service", "Receive Debit Request")}
                disabled={lamportBusy}
              >
                Receive Event: L = max(L_local, L_msg) + 1
              </button>
            </div>

            {/* Event History Table */}
            <div className="table-wrap">
              <table className="clean-table">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Type</th>
                    <th>Node</th>
                    <th>Lamport Clock</th>
                    <th>Description</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {lamportHistory.slice(0, 8).map((h, i) => (
                    <tr key={i}>
                      <td>#{h.step}</td>
                      <td><span className="status-pill info">{h.type}</span></td>
                      <td><strong>{h.nodeId}</strong></td>
                      <td><strong style={{ color: "var(--upi-orange)" }}>L = {h.clock}</strong></td>
                      <td>{h.description}</td>
                      <td style={{ fontSize: "0.76rem", color: "var(--ink-muted)" }}>{h.timestamp}</td>
                    </tr>
                  ))}
                  {lamportHistory.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", color: "var(--ink-muted)" }}>
                        No events logged yet. Trigger events above or run a payment on the Dashboard.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 3. VECTOR CLOCKS */}
      {activeTab === "vector" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Layers size={18} style={{ color: "var(--upi-orange)" }} />
                Vector Clock Algorithm & Causal Analyzer
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={resetVectorClocks}
              >
                <RotateCcw size={14} />
                Reset Vectors
              </button>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              While Lamport clocks guarantee <strong>A → B ⇒ L(A) &lt; L(B)</strong>, they cannot determine if two events are causally independent. <strong>Vector Clocks</strong> capture exact causality: <strong>V(A) &lt; V(B) ⇔ A → B</strong>. Two events are concurrent if neither vector dominates.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginBottom: "18px" }}>
              {vectorNodes.map((v) => (
                <div key={v.nodeId} style={{ padding: "14px", border: "1px solid var(--border-hairline)", borderRadius: "8px", background: "#FFFFFF", textAlign: "center" }}>
                  <div style={{ fontSize: "0.78rem", color: "var(--ink-muted)" }}>{v.name} (Idx: {v.nodeIndex})</div>
                  <div style={{ fontSize: "1.45rem", fontWeight: 900, color: "var(--upi-green)", margin: "4px 0" }}>
                    [{v.vector.join(", ")}]
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "var(--ink-muted)" }}>[Sender, Txn, NPCI, Receiver]</div>
                </div>
              ))}
            </div>

            {/* Interactive Causality Comparison */}
            <div style={{ padding: "18px", borderRadius: "10px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)" }}>
              <h4 style={{ fontSize: "1rem", color: "var(--ink-primary)", marginBottom: "10px" }}>
                Interactive Vector Causality Comparison
              </h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-end" }}>
                <div className="form-group">
                  <label className="form-label">Vector A [S, T, N, R]</label>
                  <input
                    type="text"
                    className="form-input"
                    value={vectorCompareA}
                    onChange={(e) => setVectorCompareA(e.target.value)}
                    style={{ width: "160px" }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Vector B [S, T, N, R]</label>
                  <input
                    type="text"
                    className="form-input"
                    value={vectorCompareB}
                    onChange={(e) => setVectorCompareB(e.target.value)}
                    style={{ width: "160px" }}
                  />
                </div>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleCompareVectors}
                >
                  Evaluate Causality
                </button>
              </div>

              {compareResult && (
                <div style={{ marginTop: "14px", padding: "12px", background: "#FFFFFF", borderRadius: "8px", border: "1px solid var(--border-hairline)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <span className="status-pill info">{compareResult.relation}</span>
                  </div>
                  <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)" }}>
                    {compareResult.explanation || compareResult.error}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4. GLOBAL STATE (CHANDY-LAMPORT) */}
      {activeTab === "global" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Camera size={18} style={{ color: "var(--upi-orange)" }} />
                Global State Snapshot (Chandy-Lamport Consistent Cut)
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={handleCaptureSnapshot}
                disabled={snapshotBusy}
              >
                <Camera size={14} />
                Capture Consistent Cut Snapshot
              </button>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              The <strong>Chandy-Lamport algorithm</strong> captures a consistent global state across distributed processes and communication channels without freezing execution. A cut is <strong>consistent</strong> if for every received message included in the cut, its sending event is also included.
            </p>

            {snapshots.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {snapshots.slice(0, 3).map((snap) => (
                  <div key={snap.snapshotId} style={{ padding: "18px", borderRadius: "10px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <div>
                        <strong>{snap.snapshotId}</strong>
                        <span style={{ fontSize: "0.78rem", color: "var(--ink-muted)", marginLeft: "10px" }}>{snap.timestamp}</span>
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <span className="status-pill success">Cut: CONSISTENT</span>
                        <span className="status-pill info">Lamport L={snap.lamportTime}</span>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                      <div style={{ padding: "10px", background: "var(--bg-canvas)", borderRadius: "6px", fontSize: "0.8rem" }}>
                        <strong>Sender Bank:</strong> {snap.nodeStates.senderBank.state}<br />
                        <span style={{ color: "var(--ink-muted)" }}>{snap.nodeStates.senderBank.lastAction}</span>
                      </div>
                      <div style={{ padding: "10px", background: "var(--bg-canvas)", borderRadius: "6px", fontSize: "0.8rem" }}>
                        <strong>Transaction Service:</strong> {snap.nodeStates.transactionService.state}<br />
                        <span style={{ color: "var(--ink-muted)" }}>{snap.nodeStates.transactionService.lastAction}</span>
                      </div>
                      <div style={{ padding: "10px", background: "var(--bg-canvas)", borderRadius: "6px", fontSize: "0.8rem" }}>
                        <strong>NPCI Switch:</strong> {snap.nodeStates.npci.state}<br />
                        <span style={{ color: "var(--ink-muted)" }}>{snap.nodeStates.npci.lastAction}</span>
                      </div>
                      <div style={{ padding: "10px", background: "var(--bg-canvas)", borderRadius: "6px", fontSize: "0.8rem" }}>
                        <strong>Receiver Bank:</strong> {snap.nodeStates.receiverBank.state}<br />
                        <span style={{ color: "var(--ink-muted)" }}>{snap.nodeStates.receiverBank.lastAction}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "30px", color: "var(--ink-muted)" }}>
                No global snapshots captured yet. Click "Capture Consistent Cut Snapshot" above.
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. BEACON PROTOCOL */}
      {activeTab === "beacons" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Radio size={18} style={{ color: "var(--upi-green)" }} />
                Beacon Protocol (Heartbeat-Based Failure Detection)
              </div>
              <span className="status-pill success">Interval: 2000ms</span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              In distributed systems, nodes periodically emit <strong>heartbeat beacons</strong> to declare liveness. If a node fails to beacon within the timeout window (5000ms), it transitions to <strong>SUSPECTED</strong> and then <strong>UNREACHABLE</strong>. Tripping a node in the Faults panel suppresses its beacons.
            </p>

            <div className="nodes-grid">
              {beacons.map((b) => (
                <div key={b.id} className="node-card">
                  <div className="node-card-header">
                    <span className="node-name">{b.name}</span>
                    <span className={`status-pill ${b.status === "HEALTHY" || b.status === "RECOVERED" ? "success" : "danger"}`}>
                      {b.status}
                    </span>
                  </div>

                  <div style={{ fontSize: "0.84rem", color: "var(--ink-secondary)" }}>
                    Seq: <strong>#{b.sequence}</strong><br />
                    Consecutive Misses: <strong>{b.consecutiveMisses}</strong><br />
                    Last Beacon: <span style={{ fontSize: "0.76rem", color: "var(--ink-muted)" }}>{b.lastBeaconTime}</span>
                  </div>

                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => pulseBeacon(b.id)}
                    style={{ marginTop: "auto" }}
                  >
                    Send Manual Beacon Pulse
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 6. ELECTIONS (BULLY & RING) */}
      {activeTab === "elections" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Award size={18} style={{ color: "var(--upi-orange)" }} />
                Distributed Election Algorithms (Bully & Ring)
              </div>
              <span className="status-pill info">Leader Election</span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              When the active coordinator (e.g. NPCI Switch or Transaction Coordinator) crashes, distributed nodes must elect a new coordinator without a central point of control.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "18px" }}>
              <div className="form-group">
                <label className="form-label">Crashed Coordinator Node</label>
                <select
                  className="form-select"
                  value={crashedNode}
                  onChange={(e) => setCrashedNode(e.target.value)}
                >
                  <option value="receiver-bank">Receiver Bank (Priority 4)</option>
                  <option value="npci">NPCI Switch (Priority 3)</option>
                  <option value="transaction-service">Transaction Service (Priority 2)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Election Initiator Node</label>
                <select
                  className="form-select"
                  value={initiatorNode}
                  onChange={(e) => setInitiatorNode(e.target.value)}
                >
                  <option value="sender-bank">Sender Bank (Priority 1)</option>
                  <option value="transaction-service">Transaction Service (Priority 2)</option>
                  <option value="npci">NPCI Switch (Priority 3)</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginBottom: "18px" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleRunElection("Bully")}
                disabled={electionBusy}
              >
                Run Bully Algorithm
              </button>
              <button
                type="button"
                className="btn-green"
                onClick={() => handleRunElection("Ring")}
                disabled={electionBusy}
              >
                Run Ring Algorithm
              </button>
            </div>

            {electionResult && (
              <div style={{ padding: "18px", borderRadius: "10px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <h4 style={{ fontSize: "1rem", color: "var(--ink-primary)" }}>
                    Election Trace: {electionResult.algorithm} Algorithm
                  </h4>
                  <span className="status-pill success">
                    Elected Coordinator: {electionResult.electedCoordinator}
                  </span>
                </div>
                <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)", marginBottom: "12px" }}>
                  {electionResult.explanation}
                </p>

                <div className="timeline-track">
                  {electionResult.trace.map((t) => (
                    <div key={t.step} className="timeline-step success">
                      <div className="timeline-bullet">{t.step}</div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <strong>{t.type} Message</strong>
                        <span style={{ fontSize: "0.74rem", color: "var(--ink-muted)" }}>{t.from} -&gt; {t.to}</span>
                      </div>
                      <div style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>{t.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 7. MUTEX & SELF STUDY */}
      {activeTab === "mutex" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Lock size={18} style={{ color: "var(--upi-orange)" }} />
                Distributed Mutual Exclusion (Ricart-Agrawala & Token Ring)
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => handleMutexRequest("Ricart-Agrawala")}
                  disabled={mutexBusy}
                >
                  Request Lock (Ricart-Agrawala)
                </button>
                <button
                  type="button"
                  className="btn-green"
                  onClick={() => handleMutexRequest("Token-Ring")}
                  disabled={mutexBusy}
                >
                  Request Lock (Token Ring)
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleMutexRelease}
                >
                  Release Lock
                </button>
              </div>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              To prevent race conditions when two concurrent transactions attempt to debit or credit the same bank ledger simultaneously, nodes must acquire a <strong>Distributed Mutual Exclusion Lock</strong>.
            </p>

            {mutexResult && (
              <div style={{ padding: "16px", borderRadius: "8px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)", marginBottom: "18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <strong>Status: <span className={`status-pill ${mutexResult.granted ? "success" : "warning"}`}>{mutexResult.granted ? "LOCK GRANTED" : "QUEUED"}</span></strong>
                  <span>Messages Exchanged: <strong>{mutexResult.messagesExchanged}</strong></span>
                </div>
                <div style={{ fontSize: "0.84rem", color: "var(--ink-secondary)" }}>
                  {mutexResult.selfStudyNote}
                </div>
              </div>
            )}

            {/* Self Study Topics */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "12px" }}>
              <div style={{ padding: "16px", border: "1px solid var(--border-hairline)", borderRadius: "8px", background: "#FFFFFF" }}>
                <span className="status-pill info" style={{ marginBottom: "6px" }}>Self Study 1</span>
                <h4 style={{ fontSize: "0.95rem", margin: "6px 0" }}>Lodha & Kshemkalyani's Fair Mutual Exclusion</h4>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", lineHeight: 1.5 }}>
                  Extends the Maekawa / Ricart-Agrawala algorithm by strictly enforcing fairness and bounded overtaking through timestamp-ordered dynamic request queues, avoiding starvation in heavy payment bursts.
                </p>
              </div>

              <div style={{ padding: "16px", border: "1px solid var(--border-hairline)", borderRadius: "8px", background: "#FFFFFF" }}>
                <span className="status-pill warning" style={{ marginBottom: "6px" }}>Self Study 2</span>
                <h4 style={{ fontSize: "0.95rem", margin: "6px 0" }}>Knapp's Distributed Deadlock Classification</h4>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", lineHeight: 1.5 }}>
                  Classifies distributed deadlock detection algorithms into 4 paradigms: <em>Centralized</em>, <em>Hierarchical</em>, <em>Distributed</em> (edge-chasing probes like Mitchell-Merritt), and <em>Hierarchical-Cluster</em> models.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
