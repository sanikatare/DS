import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import PageShell from "../components/layout/PageShell";
import {
  fetchSnapshot,
  toggleFailure,
  resetSystem,
  initiateTransaction,
  connectTransactionSocket,
} from "../api";
import {
  MessageSquare,
  Zap,
  Radio,
  Share2,
  ShieldAlert,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Terminal,
} from "lucide-react";

export default function Unit2View() {
  const [activeTab, setActiveTab] = useState("rpc");
  const [snapshot, setSnapshot] = useState(null);
  const [connStatus, setConnStatus] = useState("connecting");
  const [rpcLoading, setRpcLoading] = useState(false);
  const [rpcResult, setRpcResult] = useState(null);
  const [chaosLoading, setChaosLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const snap = await fetchSnapshot();
      setSnapshot(snap);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadData();
    const ws = connectTransactionSocket(() => loadData(), setConnStatus);
    return () => ws.close();
  }, [loadData]);

  async function handleTestProtocol(mode) {
    setRpcLoading(true);
    setRpcResult(null);
    try {
      const res = await initiateTransaction({
        senderId: "sanika@bank",
        receiverId: "navya@bank",
        amount: 250,
        mode,
      });
      setRpcResult(res);
      await loadData();
    } catch (e) {
      setRpcResult({ error: e.message });
    } finally {
      setRpcLoading(false);
    }
  }

  async function handleToggleFailure(target, currentlyFailed) {
    setChaosLoading(true);
    try {
      await toggleFailure(target, currentlyFailed);
      await loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setChaosLoading(false);
    }
  }

  const failureState = snapshot?.failureState || {};
  const circuitBreakers = failureState.circuit_breakers || {};

  return (
    <PageShell connStatus={connStatus}>
      {/* Unit Header */}
      <div className="page-header">
        <div>
          <div className="unit-tag" style={{ background: "var(--upi-green-tint)", color: "var(--upi-green)", borderColor: "var(--upi-green-border)" }}>
            Unit II — Communication & Fault Tolerance
          </div>
          <h1 className="page-title">Distributed Communication Mechanisms</h1>
          <p className="page-subtitle">
            Remote Procedure Calls (gRPC), Message-Oriented Middleware (AMQP), WebSockets, P2P & WebRTC, Circuit Breakers, and VPA Addressing.
          </p>
        </div>

        {/* Sub-tab Navigation */}
        <div className="segmented-pills">
          <button
            type="button"
            className={`seg-pill ${activeTab === "rpc" ? "active" : ""}`}
            onClick={() => setActiveTab("rpc")}
          >
            RPC / gRPC
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "amqp" ? "active" : ""}`}
            onClick={() => setActiveTab("amqp")}
          >
            Message Queues (AMQP)
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "streams" ? "active" : ""}`}
            onClick={() => setActiveTab("streams")}
          >
            Streams & P2P / WebRTC
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "fault" ? "active" : ""}`}
            onClick={() => setActiveTab("fault")}
          >
            Fault Tolerance & Chaos
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "naming" ? "active" : ""}`}
            onClick={() => setActiveTab("naming")}
          >
            Names & Identifiers
          </button>
        </div>
      </div>

      {/* Tab 1: RPC / gRPC */}
      {activeTab === "rpc" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Zap size={18} style={{ color: "var(--upi-orange)" }} />
                Remote Procedure Call (RPC) & gRPC (HTTP/2)
              </div>
              <span className="status-pill success">Phase 2 Protocol</span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              In Remote Procedure Call (RPC), a process invokes a procedure on a remote computer as if it were a local call. The client library serializes (marshals) request parameters into binary Protocol Buffers and transmits them across an HTTP/2 multiplexed stream.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "18px" }}>
              <div className="code-preview">
                <strong>// Protobuf Schema: services/proto/upi.proto</strong><br />
                syntax = "proto3";<br /><br />
                message DebitRequest &#123;<br />
                &nbsp;&nbsp;string txn_id = 1;<br />
                &nbsp;&nbsp;string vpa = 2;<br />
                &nbsp;&nbsp;double amount = 3;<br />
                &#125;<br /><br />
                message DebitResponse &#123;<br />
                &nbsp;&nbsp;bool success = 1;<br />
                &nbsp;&nbsp;string auth_code = 2;<br />
                &#125;
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px", background: "var(--bg-canvas)", padding: "16px", borderRadius: "8px" }}>
                <h4 style={{ fontSize: "0.95rem", color: "var(--ink-primary)" }}>Interactive gRPC Invocation</h4>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-muted)" }}>
                  Trigger a binary RPC over HTTP/2 between the Transaction Coordinator and Sender Bank Service.
                </p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => handleTestProtocol("grpc")}
                  disabled={rpcLoading}
                  style={{ alignSelf: "flex-start" }}
                >
                  {rpcLoading ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
                  Invoke gRPC VerifyAndDebit()
                </button>

                {rpcResult && (
                  <div style={{ marginTop: "10px", padding: "10px", background: "#FFFFFF", borderRadius: "6px", border: "1px solid var(--border-hairline)", fontSize: "0.8rem" }}>
                    <strong>RPC Status:</strong> {rpcResult.status || "OK"}<br />
                    <strong>Txn ID:</strong> {rpcResult.transactionId}<br />
                    <strong>Protocol:</strong> HTTP/2 gRPC Protobuf
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Message Queues (AMQP / RabbitMQ) */}
      {activeTab === "amqp" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <MessageSquare size={18} style={{ color: "var(--upi-green)" }} />
                Message-Oriented Communication (AMQP & RabbitMQ)
              </div>
              <span className="status-pill info">Asynchronous Decoupling</span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              Message-Oriented Middleware (MOM) provides asynchronous, decoupled communication where sender and receiver do not need to be active simultaneously. Messages are held in persistent queues until consumer workers process them.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginBottom: "18px" }}>
              <div style={{ padding: "16px", border: "1px solid var(--border-hairline)", borderRadius: "8px", background: "#FFFFFF" }}>
                <span className="status-pill warning" style={{ marginBottom: "8px" }}>Topic Exchange</span>
                <h4 style={{ margin: "6px 0", fontSize: "0.95rem" }}>upi.transactions</h4>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
                  Distributes payment event messages according to binding patterns such as <code>txn.debit.#</code> and <code>txn.settle.#</code>.
                </p>
              </div>

              <div style={{ padding: "16px", border: "1px solid var(--border-hairline)", borderRadius: "8px", background: "#FFFFFF" }}>
                <span className="status-pill success" style={{ marginBottom: "8px" }}>Durable Consumer Queue</span>
                <h4 style={{ margin: "6px 0", fontSize: "0.95rem" }}>q.sender.debit</h4>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
                  Workers pull debit instructions from the durable queue with manual acknowledgements (ACK), guaranteeing at-least-once delivery.
                </p>
              </div>

              <div style={{ padding: "16px", border: "1px solid var(--border-hairline)", borderRadius: "8px", background: "#FFFFFF" }}>
                <span className="status-pill danger" style={{ marginBottom: "8px" }}>Dead Letter Exchange</span>
                <h4 style={{ margin: "6px 0", fontSize: "0.95rem" }}>upi.dlx</h4>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
                  Poison messages or exhausted retries are dead-lettered for manual audit and regulatory reconciliation.
                </p>
              </div>
            </div>

            <button
              type="button"
              className="btn-green"
              onClick={() => handleTestProtocol("rabbitmq")}
              disabled={rpcLoading}
            >
              {rpcLoading ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
              Publish AMQP Transaction Message
            </button>
          </div>
        </div>
      )}

      {/* Tab 3: Streams & P2P / WebRTC */}
      {activeTab === "streams" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Radio size={18} style={{ color: "var(--blue-accent)" }} />
                Stream-Oriented Communication (WebSockets) & WebRTC P2P
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <span className="status-pill info">Low Latency Push</span>
                <Link to="/webrtc-stream" className="btn-primary" style={{ textDecoration: "none", fontSize: "0.8rem", padding: "4px 10px" }}>
                  Open Full Studio →
                </Link>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <div style={{ padding: "16px", borderRadius: "10px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <h4 style={{ fontSize: "1rem", color: "var(--ink-primary)" }}>
                    Persistent WebSockets (/ws/transactions)
                  </h4>
                  <span className={`status-pill ${connStatus === "connected" ? "success" : "warning"}`} style={{ fontSize: "0.72rem" }}>
                    {connStatus}
                  </span>
                </div>
                <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)", marginBottom: "12px", lineHeight: 1.5 }}>
                  Full-duplex TCP stream delivering real-time state changes directly to web clients. Features a 500-event ring buffer for automatic replay on reconnection.
                </p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => handleTestProtocol("websocket")}
                  disabled={rpcLoading}
                  style={{ fontSize: "0.82rem" }}
                >
                  {rpcLoading ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
                  Broadcast via WebSocket Stream
                </button>
              </div>

              <div style={{ padding: "16px", borderRadius: "10px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <h4 style={{ fontSize: "1rem", color: "var(--ink-primary)" }}>
                    WebRTC P2P DataChannels (SCTP)
                  </h4>
                  <span className="status-pill info" style={{ fontSize: "0.72rem" }}>
                    Mesh Direct
                  </span>
                </div>
                <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)", marginBottom: "12px", lineHeight: 1.5 }}>
                  Browser-to-browser and bank-to-bank direct peer data channels over SCTP/UDP. Bypasses central NPCI routing after initial SDP handshake.
                </p>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleTestProtocol("p2p")}
                    disabled={rpcLoading}
                    style={{ fontSize: "0.82rem" }}
                  >
                    <Share2 size={14} />
                    Direct P2P Micro-Pay
                  </button>
                  <Link
                    to="/webrtc-stream"
                    className="btn-green"
                    style={{ textDecoration: "none", fontSize: "0.82rem", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <Zap size={14} />
                    Live WebRTC Studio
                  </Link>
                </div>
              </div>
            </div>

            {rpcResult && (
              <div style={{ padding: "12px 16px", background: "#FFFFFF", borderRadius: "8px", border: "1px solid var(--border-hairline)", fontSize: "0.82rem" }}>
                <strong>Stream Output:</strong> Transaction {rpcResult.transactionId} processed via <strong>{rpcResult.mode || "stream"}</strong>.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Fault Tolerance & Chaos */}
      {activeTab === "fault" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <ShieldAlert size={18} style={{ color: "var(--crimson)" }} />
                Fault Tolerance & 3-State Circuit Breakers
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={resetSystem}
              >
                <RotateCcw size={14} />
                Reset All Failures
              </button>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "18px" }}>
              Distributed systems must tolerate partial failure. The <strong>Circuit Breaker</strong> pattern detects failures and encapsulates the logic of preventing a failure from constantly recurring during maintenance or outages.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
              {/* Sender Bank Fault Toggle */}
              <div style={{ padding: "16px", borderRadius: "10px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <strong>Sender Bank Node</strong>
                  <span className={`status-pill ${failureState.sender_bank_failure ? "danger" : "success"}`}>
                    {failureState.sender_bank_failure ? "CRASHED" : "HEALTHY"}
                  </span>
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--ink-muted)", marginBottom: "12px" }}>
                  Simulates 503 Service Unavailable on remitter CBS.
                </p>
                <button
                  type="button"
                  className={failureState.sender_bank_failure ? "btn-secondary" : "btn-danger"}
                  onClick={() => handleToggleFailure("sender-bank", failureState.sender_bank_failure)}
                  disabled={chaosLoading}
                >
                  {failureState.sender_bank_failure ? "Restore Node" : "Trip Outage (503)"}
                </button>
              </div>

              {/* NPCI Switch Fault Toggle */}
              <div style={{ padding: "16px", borderRadius: "10px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <strong>NPCI Switch Simulator</strong>
                  <span className={`status-pill ${failureState.npci_failure ? "danger" : "success"}`}>
                    {failureState.npci_failure ? "PARTITIONED" : "HEALTHY"}
                  </span>
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--ink-muted)", marginBottom: "12px" }}>
                  Simulates interbank routing partition failure.
                </p>
                <button
                  type="button"
                  className={failureState.npci_failure ? "btn-secondary" : "btn-danger"}
                  onClick={() => handleToggleFailure("npci", failureState.npci_failure)}
                  disabled={chaosLoading}
                >
                  {failureState.npci_failure ? "Restore Switch" : "Sever Switch Route"}
                </button>
              </div>

              {/* Receiver Bank Fault Toggle */}
              <div style={{ padding: "16px", borderRadius: "10px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <strong>Receiver Bank Node</strong>
                  <span className={`status-pill ${failureState.receiver_bank_failure ? "danger" : "success"}`}>
                    {failureState.receiver_bank_failure ? "CRASHED" : "HEALTHY"}
                  </span>
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--ink-muted)", marginBottom: "12px" }}>
                  Tests Saga Compensating Rollback refunding the sender.
                </p>
                <button
                  type="button"
                  className={failureState.receiver_bank_failure ? "btn-secondary" : "btn-danger"}
                  onClick={() => handleToggleFailure("receiver-bank", failureState.receiver_bank_failure)}
                  disabled={chaosLoading}
                >
                  {failureState.receiver_bank_failure ? "Restore Node" : "Trip Credit Outage"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Names & Identifiers */}
      {activeTab === "naming" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <CheckCircle2 size={18} style={{ color: "var(--upi-orange)" }} />
                Names, Identifiers, and Addresses (Self Study)
              </div>
              <span className="status-pill neutral">DNS & Addressing</span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "18px" }}>
              In distributed systems, a <strong>Name</strong> is a human-friendly string (e.g. <code>sanika@bank</code>), an <strong>Identifier</strong> uniquely refers to an entity for lifetime, and an <strong>Address</strong> specifies where that entity is located (IP address + Port).
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
              <div style={{ padding: "16px", border: "1px solid var(--border-hairline)", borderRadius: "8px" }}>
                <strong style={{ color: "var(--upi-orange)" }}>1. Name: Virtual Payment Address (VPA)</strong>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", marginTop: "6px" }}>
                  Format: <code>username@bankhandle</code>. Decouples human identifiers from sensitive physical account numbers.
                </p>
              </div>

              <div style={{ padding: "16px", border: "1px solid var(--border-hairline)", borderRadius: "8px" }}>
                <strong style={{ color: "var(--upi-green)" }}>2. Address: Physical Routing (IFSC & IP)</strong>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", marginTop: "6px" }}>
                  NPCI directory maps the handle (e.g. <code>@okhdfcbank</code>) to the bank's gateway IP address (<code>10.0.1.5:8001</code>) and CBS routing code.
                </p>
              </div>

              <div style={{ padding: "16px", border: "1px solid var(--border-hairline)", borderRadius: "8px" }}>
                <strong style={{ color: "var(--blue-accent)" }}>3. Identifier: Idempotency Key (UUIDv4)</strong>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", marginTop: "6px" }}>
                  Unique immutable transaction key ensuring duplicate network retransmissions are detected and processed exactly once.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
