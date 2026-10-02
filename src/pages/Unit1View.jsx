import { useState, useEffect } from "react";
import PageShell from "../components/layout/PageShell";
import { fetchUnit1Overview } from "../api";
import {
  Layers,
  Share2,
  Lock,
  Globe,
  Zap,
  Server,
  Cpu,
  Shield,
  Box,
  CheckCircle2,
  ArrowRight,
  Terminal,
} from "lucide-react";

export default function Unit1View() {
  const [activeTab, setActiveTab] = useState("goals");
  const [overview, setOverview] = useState(null);
  const [selectedArch, setSelectedArch] = useState("layered");

  useEffect(() => {
    fetchUnit1Overview().then(setOverview).catch(console.error);
  }, []);

  return (
    <PageShell>
      {/* Unit Header */}
      <div className="page-header">
        <div>
          <div className="unit-tag">Unit I — 7 Hours</div>
          <h1 className="page-title">Introduction to Distributed Systems</h1>
          <p className="page-subtitle">
            Foundations of distributed architectures, design goals, system classifications, and the critical role of NPCI as distributed middleware.
          </p>
        </div>

        {/* Sub-tab navigation */}
        <div className="segmented-pills">
          <button
            type="button"
            className={`seg-pill ${activeTab === "goals" ? "active" : ""}`}
            onClick={() => setActiveTab("goals")}
          >
            Goals & Types
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "arch" ? "active" : ""}`}
            onClick={() => setActiveTab("arch")}
          >
            4 Architectures
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "design" ? "active" : ""}`}
            onClick={() => setActiveTab("design")}
          >
            Design Issues & Middleware
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "virtualization" ? "active" : ""}`}
            onClick={() => setActiveTab("virtualization")}
          >
            Virtualization & Models
          </button>
        </div>
      </div>

      {/* Definition Banner */}
      <div className="edu-callout" style={{ marginBottom: "22px" }}>
        <div className="edu-callout-icon">
          <Globe size={22} />
        </div>
        <div>
          <div className="edu-callout-title">Formal Definition of Distributed System (Tanenbaum / Coulouris)</div>
          <div className="edu-callout-desc">
            {overview?.definition ||
              "A collection of autonomous computing entities that communicate over a network and coordinate actions by passing messages, appearing to users as a single coherent system."}
          </div>
        </div>
      </div>

      {/* Tab 1: Goals & Types */}
      {activeTab === "goals" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* 6 Core Goals Grid */}
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Share2 size={18} style={{ color: "var(--upi-orange)" }} />
                6 Core Goals of Distributed Systems (UPI Context)
              </div>
              <span className="status-pill success">Syllabus Core</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
              {(overview?.goals || [
                { goal: "Resource Sharing", upiContext: "Sharing core-banking ledgers, NPCI routing tables, and fraud-detection models securely across multiple autonomous financial institutions." },
                { goal: "Openness", upiContext: "Standardized UPI specifications allow any scheduled bank or certified 3rd-party application (TPAP) to integrate using standard APIs." },
                { goal: "Concurrency", upiContext: "Thousands of simultaneous interbank payments process concurrently without corrupting account balances using isolation and 2-phase locks." },
                { goal: "Scalability", upiContext: "Horizontal scaling of stateless API gateways and partitioned account databases across geographic zones." },
                { goal: "Fault Tolerance", upiContext: "Circuit breakers, timeout deadlines, and compensating Saga rollbacks ensure partial node crashes do not freeze customer funds." },
                { goal: "Transparency", upiContext: "Hiding distribution complexity: Access, Location, Migration, Replication, Concurrency, and Failure transparency." },
              ]).map((g, idx) => (
                <div key={idx} style={{ padding: "16px", borderRadius: "10px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <span className="status-pill info" style={{ padding: "2px 8px" }}>Goal {idx + 1}</span>
                    <strong style={{ fontSize: "1rem", color: "var(--ink-primary)" }}>{g.goal}</strong>
                  </div>
                  <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", lineHeight: 1.5 }}>
                    {g.upiContext}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* 3 Types of Distributed Systems */}
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Cpu size={18} style={{ color: "var(--upi-green)" }} />
                Types of Distributed Systems
              </div>
              <span className="status-pill neutral">Classification</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px" }}>
              <div style={{ padding: "18px", borderRadius: "12px", border: "1px solid var(--border-hairline)", background: "var(--bg-canvas)" }}>
                <span className="status-pill info" style={{ marginBottom: "8px" }}>1. Distributed Computing</span>
                <h4 style={{ fontSize: "1.05rem", fontWeight: 800, margin: "6px 0", color: "var(--ink-primary)" }}>
                  High-Performance Clusters & Grids
                </h4>
                <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)" }}>
                  Dedicated to computationally intensive tasks such as end-of-day batch ledger clearance, cryptographic signature verification (PKI / HSM), and real-time fraud scoring across millions of transactions.
                </p>
              </div>

              <div style={{ padding: "18px", borderRadius: "12px", border: "1px solid var(--border-hairline)", background: "var(--bg-canvas)" }}>
                <span className="status-pill success" style={{ marginBottom: "8px" }}>2. Distributed Information</span>
                <h4 style={{ fontSize: "1.05rem", fontWeight: 800, margin: "6px 0", color: "var(--ink-primary)" }}>
                  Enterprise Transaction Processing (TP)
                </h4>
                <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)" }}>
                  Connects heterogeneous banking relational databases through RPC, gRPC, and message queues. Implements ACID transactions across distinct bank boundaries using transaction monitors and Saga compensations.
                </p>
              </div>

              <div style={{ padding: "18px", borderRadius: "12px", border: "1px solid var(--border-hairline)", background: "var(--bg-canvas)" }}>
                <span className="status-pill warning" style={{ marginBottom: "8px" }}>3. Distributed Pervasive</span>
                <h4 style={{ fontSize: "1.05rem", fontWeight: 800, margin: "6px 0", color: "var(--ink-primary)" }}>
                  Ubiquitous / Mobile & IoT Edge
                </h4>
                <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)" }}>
                  Embedded payment soundboxes, dynamic QR displays, and consumer smartphones acting as pervasive edge nodes that communicate over cellular networks with ad-hoc discovery.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: 4 Architectures */}
      {activeTab === "arch" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          {/* Architecture Selector */}
          <div className="segmented-pills" style={{ alignSelf: "flex-start" }}>
            {[
              { id: "layered", label: "Layered / Multi-Tier" },
              { id: "object", label: "Object-Based (RMI/RPC)" },
              { id: "event", label: "Event-Based (Pub/Sub)" },
              { id: "p2p", label: "Peer-to-Peer (P2P)" },
            ].map((a) => (
              <button
                key={a.id}
                type="button"
                className={`seg-pill ${selectedArch === a.id ? "active" : ""}`}
                onClick={() => setSelectedArch(a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div className="card-clean">
            {selectedArch === "layered" && (
              <div>
                <div className="card-header-bar">
                  <div className="card-title">
                    <Layers size={18} style={{ color: "var(--upi-orange)" }} />
                    Layered & Multi-Tier Architecture
                  </div>
                  <span className="status-pill info">Default UPI Architecture</span>
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", marginBottom: "18px" }}>
                  Components are organized hierarchically where each layer provides services to the layer above it and consumes services from the layer below.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
                  <div style={{ padding: "16px", borderRadius: "10px", border: "2px solid var(--border-hairline)", background: "#FFFFFF" }}>
                    <div className="status-pill neutral">Tier 1: Presentation</div>
                    <h4 style={{ margin: "8px 0 4px", fontSize: "0.95rem" }}>Client Web & Mobile App</h4>
                    <p style={{ fontSize: "0.8rem", color: "var(--ink-muted)" }}>
                      Handles user interaction, VPA input, cryptographic PIN entry, and WebSocket push stream rendering.
                    </p>
                  </div>

                  <div style={{ padding: "16px", borderRadius: "10px", border: "2px solid var(--upi-orange-border)", background: "var(--upi-orange-tint)" }}>
                    <div className="status-pill warning">Tier 2: API Gateway</div>
                    <h4 style={{ margin: "8px 0 4px", fontSize: "0.95rem" }}>Express Gateway (:8000)</h4>
                    <p style={{ fontSize: "0.8rem", color: "var(--ink-secondary)" }}>
                      Performs rate limiting, TLS termination, idempotency index checks, and routing.
                    </p>
                  </div>

                  <div style={{ padding: "16px", borderRadius: "10px", border: "2px solid var(--upi-green-border)", background: "var(--upi-green-tint)" }}>
                    <div className="status-pill success">Tier 3: Orchestration</div>
                    <h4 style={{ margin: "8px 0 4px", fontSize: "0.95rem" }}>Transaction Coordinator</h4>
                    <p style={{ fontSize: "0.8rem", color: "var(--ink-secondary)" }}>
                      Coordinates 2-Phase Sagas, handles circuit breakers, and manages Lamport logical clocks.
                    </p>
                  </div>

                  <div style={{ padding: "16px", borderRadius: "10px", border: "2px solid var(--border-hairline)", background: "#FFFFFF" }}>
                    <div className="status-pill info">Tier 4: Enterprise Services</div>
                    <h4 style={{ margin: "8px 0 4px", fontSize: "0.95rem" }}>Bank CBS (:8001, :8003) & NPCI (:8002)</h4>
                    <p style={{ fontSize: "0.8rem", color: "var(--ink-muted)" }}>
                      Core Banking Ledgers, atomic balance updates, and national interbank switch clearance.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {selectedArch === "object" && (
              <div>
                <div className="card-header-bar">
                  <div className="card-title">
                    <Box size={18} style={{ color: "var(--upi-green)" }} />
                    Object-Based Architecture (RMI & gRPC)
                  </div>
                  <span className="status-pill info">RPC Stubs & Skeletons</span>
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", marginBottom: "16px" }}>
                  Components are treated as distributed objects connected via Remote Procedure Calls. The client invokes methods on a local <em>Client Stub (Proxy)</em>, which marshals arguments over the wire to the <em>Server Skeleton</em>.
                </p>

                <div className="code-preview" style={{ marginBottom: "16px" }}>
                  <strong>// Protocol Buffers Interface Definition (services/proto/upi.proto)</strong><br />
                  service SenderBankService &#123;<br />
                  &nbsp;&nbsp;rpc VerifyAndDebit (DebitRequest) returns (DebitResponse);<br />
                  &#125;<br />
                  service ReceiverBankService &#123;<br />
                  &nbsp;&nbsp;rpc CreditAccount (CreditRequest) returns (CreditResponse);<br />
                  &#125;
                </div>
              </div>
            )}

            {selectedArch === "event" && (
              <div>
                <div className="card-header-bar">
                  <div className="card-title">
                    <Zap size={18} style={{ color: "var(--amber)" }} />
                    Event-Based Architecture (Publish-Subscribe)
                  </div>
                  <span className="status-pill warning">Decoupled Queue Workers</span>
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", marginBottom: "16px" }}>
                  Processes communicate asynchronously by publishing events to an event bus (RabbitMQ AMQP Broker). Publishers and subscribers are completely decoupled in both time and space.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                  <div style={{ padding: "14px", border: "1px solid var(--border-hairline)", borderRadius: "8px" }}>
                    <strong>Topic Exchange: <code>upi.transactions</code></strong>
                    <p style={{ fontSize: "0.82rem", color: "var(--ink-muted)", marginTop: "4px" }}>
                      Routes messages based on wildcard routing keys (e.g. <code>txn.debit.initiate</code>, <code>txn.credit.settled</code>).
                    </p>
                  </div>
                  <div style={{ padding: "14px", border: "1px solid var(--border-hairline)", borderRadius: "8px" }}>
                    <strong>Dead Letter Exchange (DLX)</strong>
                    <p style={{ fontSize: "0.82rem", color: "var(--ink-muted)", marginTop: "4px" }}>
                      Guarantees zero payment loss by capturing unroutable or rejected message payloads for manual reconciliation.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {selectedArch === "p2p" && (
              <div>
                <div className="card-header-bar">
                  <div className="card-title">
                    <Share2 size={18} style={{ color: "var(--blue-accent)" }} />
                    Peer-to-Peer (P2P) Architecture
                  </div>
                  <span className="status-pill success">Direct Bank Mesh</span>
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", marginBottom: "16px" }}>
                  All nodes have equal privileges and communicate directly with each other without traversing a centralized switch bottleneck.
                </p>

                <div style={{ padding: "16px", borderRadius: "10px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)" }}>
                  <h4 style={{ fontSize: "0.95rem", marginBottom: "6px" }}>Direct Bank-to-Bank Wire & WebRTC DataChannels</h4>
                  <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)" }}>
                    When NPCI Switch is congested or undergoing scheduled maintenance, participating banks can establish direct mutual TLS connections or browser-to-browser WebRTC SCTP channels to clear transactions.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Design Issues & Middleware */}
      {activeTab === "design" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          {/* Middleware Role Card */}
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Shield size={18} style={{ color: "var(--upi-orange)" }} />
                The Role of Middleware in Distributed Systems (NPCI)
              </div>
              <span className="status-pill success">Core Topic</span>
            </div>
            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              <strong>Middleware</strong> is software that lies between an operating system and the applications running on it. Essentially functioning as a hidden translation layer, middleware enables communication and data management for distributed applications.
            </p>

            <div style={{ padding: "16px", borderRadius: "10px", background: "var(--upi-orange-tint)", border: "1px solid var(--upi-orange-border)" }}>
              <h4 style={{ color: "var(--upi-orange)", fontSize: "0.95rem", marginBottom: "6px" }}>
                How NPCI Acts as Distributed Payment Middleware:
              </h4>
              <ul style={{ paddingLeft: "20px", fontSize: "0.85rem", color: "var(--ink-secondary)", display: "flex", flexDirection: "column", gap: "6px" }}>
                <li><strong>Protocol Translation:</strong> Bridges HTTP REST requests from fintech apps into ISO 8583 / ISO 20022 financial messages required by legacy bank mainframes.</li>
                <li><strong>Address Resolution:</strong> Maps virtual payment addresses (e.g. <code>sanika@bank</code>) to real account numbers and bank IFSC codes.</li>
                <li><strong>Security & Non-Repudiation:</strong> Validates digital signatures, tokenizes credentials, and coordinates mutual TLS sessions across banks.</li>
                <li><strong>Distributed Consensus:</strong> Guarantees that funds deducted from bank A are strictly credited to bank B without double-spending.</li>
              </ul>
            </div>
          </div>

          {/* 8 Transparencies Matrix */}
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Globe size={18} style={{ color: "var(--upi-green)" }} />
                Distributed Systems Transparency Matrix
              </div>
              <span className="status-pill neutral">ISO/IEC 10746 ODP</span>
            </div>

            <div className="table-wrap">
              <table className="clean-table">
                <thead>
                  <tr>
                    <th>Transparency</th>
                    <th>Distributed Systems Definition</th>
                    <th>UPI System Implementation</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Access</strong></td>
                    <td>Hides differences in data representation & protocols</td>
                    <td>Unified REST & gRPC endpoints hide underlying bank CBS differences</td>
                    <td><span className="status-pill success">Achieved</span></td>
                  </tr>
                  <tr>
                    <td><strong>Location</strong></td>
                    <td>Hides where resources are physically located</td>
                    <td>VPAs (<code>sanika@bank</code>) abstract physical bank branch & server location</td>
                    <td><span className="status-pill success">Achieved</span></td>
                  </tr>
                  <tr>
                    <td><strong>Migration</strong></td>
                    <td>Hides that a resource may move to another location</td>
                    <td>Users can change linked bank accounts without changing their UPI ID</td>
                    <td><span className="status-pill success">Achieved</span></td>
                  </tr>
                  <tr>
                    <td><strong>Replication</strong></td>
                    <td>Hides that a resource is replicated across nodes</td>
                    <td>Multi-region database replicas replicate balances invisibly</td>
                    <td><span className="status-pill success">Achieved</span></td>
                  </tr>
                  <tr>
                    <td><strong>Concurrency</strong></td>
                    <td>Hides that a resource may be shared by several users</td>
                    <td>Locking and transactional isolation prevent balance race conditions</td>
                    <td><span className="status-pill success">Achieved</span></td>
                  </tr>
                  <tr>
                    <td><strong>Failure</strong></td>
                    <td>Hides the failure and recovery of resources</td>
                    <td>Circuit breakers and automatic Saga rollbacks protect customer funds</td>
                    <td><span className="status-pill success">Achieved</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Virtualization & Computation Model */}
      {activeTab === "virtualization" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Server size={18} style={{ color: "var(--blue-accent)" }} />
                The Role of Virtualization in Distributed Systems (Self Study)
              </div>
              <span className="status-pill info">Virtualization & Isolation</span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              Virtualization provides the fundamental abstraction layer that enables modern cloud-native distributed systems. By decoupling software services from physical hardware, financial systems gain fault isolation, dynamic scalability, and portability.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
              <div style={{ padding: "16px", borderRadius: "10px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <h4 style={{ fontSize: "0.95rem", color: "var(--ink-primary)", marginBottom: "6px" }}>
                  1. Hardware vs OS Virtualization
                </h4>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
                  Type-1 Hypervisors run dedicated bank instances in strict security perimeters. OS-level containerization (Docker) isolates the 4 microservices with zero boot overhead.
                </p>
              </div>

              <div style={{ padding: "16px", borderRadius: "10px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <h4 style={{ fontSize: "0.95rem", color: "var(--ink-primary)", marginBottom: "6px" }}>
                  2. Fault Containment
                </h4>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
                  If a memory leak or crash occurs on the Sender Bank Service (:8001), the virtual sandbox prevents it from taking down the NPCI Switch or Transaction Coordinator.
                </p>
              </div>

              <div style={{ padding: "16px", borderRadius: "10px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <h4 style={{ fontSize: "0.95rem", color: "var(--ink-primary)", marginBottom: "6px" }}>
                  3. Model of Distributed Computations
                </h4>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
                  Processes execute event sequences (local, send, receive). Without a global clock, causal dependencies are captured using Lamport and Vector clocks.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
