import { useState, useEffect } from "react";
import PageShell from "../components/layout/PageShell";
import { fetchUnit4Overview, fetchArchitecture } from "../api";
import {
  Globe,
  Box,
  FolderTree,
  Zap,
  Building,
  Shield,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Server,
  Cloud,
  Cpu,
} from "lucide-react";

export default function Unit4View() {
  const [activeTab, setActiveTab] = useState("web");
  const [data, setData] = useState(null);
  const [arch, setArch] = useState(null);

  useEffect(() => {
    fetchUnit4Overview().then(setData).catch(console.error);
    fetchArchitecture().then(setArch).catch(console.error);
  }, []);

  return (
    <PageShell>
      {/* Unit Header */}
      <div className="page-header">
        <div>
          <div className="unit-tag" style={{ background: "var(--blue-tint)", color: "var(--blue-accent)", borderColor: "var(--blue-border)" }}>
            Unit IV — Emerging Distributed Paradigms
          </div>
          <h1 className="page-title">Emerging Distributed Paradigms & Case Studies</h1>
          <p className="page-subtitle">
            Distributed Web Systems, Object-Based Models, Distributed File Systems, Serverless Architectures, Case Studies (Cloudflare, AWS, Hadoop, K8s, Megaport), and Blockchain vs Modern DB Trade-offs.
          </p>
        </div>

        {/* Sub-tab Navigation */}
        <div className="segmented-pills">
          <button
            type="button"
            className={`seg-pill ${activeTab === "web" ? "active" : ""}`}
            onClick={() => setActiveTab("web")}
          >
            Web-Based Systems
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "objects" ? "active" : ""}`}
            onClick={() => setActiveTab("objects")}
          >
            Objects & File Systems
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "serverless" ? "active" : ""}`}
            onClick={() => setActiveTab("serverless")}
          >
            Serverless (FaaS)
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "casestudies" ? "active" : ""}`}
            onClick={() => setActiveTab("casestudies")}
          >
            Case Studies
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "tradeoffs" ? "active" : ""}`}
            onClick={() => setActiveTab("tradeoffs")}
          >
            Blockchain vs Databases
          </button>
        </div>
      </div>

      {/* 1. DISTRIBUTED WEB-BASED SYSTEMS */}
      {activeTab === "web" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Globe size={18} style={{ color: "var(--upi-orange)" }} />
                Distributed Web-Based Systems
              </div>
              <span className="status-pill success">Multi-Tier Architecture</span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              Modern distributed web systems utilize a multi-tier organization decoupling the user presentation tier from business logic, data persistence, and inter-service routing.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginBottom: "18px" }}>
              {(arch?.tiers || []).map((tier, idx) => (
                <div key={idx} style={{ padding: "16px", borderRadius: "10px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                  <span className="status-pill info" style={{ marginBottom: "6px" }}>Tier {idx + 1}</span>
                  <h4 style={{ fontSize: "0.95rem", margin: "6px 0", color: "var(--ink-primary)" }}>{tier.tier}</h4>
                  <div style={{ fontSize: "0.8rem", color: "var(--ink-muted)", marginBottom: "8px" }}>
                    <strong>Protocols:</strong> {tier.protocols?.join(", ")}
                  </div>
                  <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
                    {tier.responsibility}
                  </p>
                </div>
              ))}
            </div>

            <div style={{ padding: "16px", borderRadius: "10px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)" }}>
              <h4 style={{ fontSize: "0.95rem", color: "var(--ink-primary)", marginBottom: "8px" }}>
                End-to-End Communication Lifecycle:
              </h4>
              <ol style={{ paddingLeft: "20px", fontSize: "0.82rem", color: "var(--ink-secondary)", display: "flex", flexDirection: "column", gap: "5px" }}>
                {(arch?.communicationFlow || []).map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* 2. OBJECT-BASED & FILE SYSTEMS */}
      {activeTab === "objects" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          {/* Object-Based Systems */}
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Box size={18} style={{ color: "var(--upi-green)" }} />
                Distributed Object-Based Systems
              </div>
              <span className="status-pill neutral">RMI / CORBA / Protobuf</span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              In Distributed Object-Based Systems, states and behaviors are encapsulated inside remote objects. A client accesses a remote object via a <strong>Stub (Proxy)</strong>, which marshals the method name and parameters over the network to the server-side <strong>Skeleton</strong>.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div style={{ padding: "16px", border: "1px solid var(--border-hairline)", borderRadius: "8px" }}>
                <h4 style={{ fontSize: "0.95rem", marginBottom: "6px" }}>1. Remote Account Interface</h4>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
                  Exposes methods like <code>debitAccount(vpa, amount)</code> and <code>creditAccount(vpa, amount)</code>. The caller does not know whether the object resides in the same process or in an overseas data center.
                </p>
              </div>

              <div style={{ padding: "16px", border: "1px solid var(--border-hairline)", borderRadius: "8px" }}>
                <h4 style={{ fontSize: "0.95rem", marginBottom: "6px" }}>2. Distributed Garbage Collection</h4>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
                  Uses reference counting or leasing: clients renew their leases periodically; unrenewed remote object proxies are automatically reclaimed.
                </p>
              </div>
            </div>
          </div>

          {/* Distributed File Systems */}
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <FolderTree size={18} style={{ color: "var(--amber)" }} />
                Distributed File Systems (DFS)
              </div>
              <span className="status-pill warning">Replication & Consistency</span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              Distributed File Systems (e.g. NFS, HDFS, Google File System) allow clients to transparently access files distributed across network servers.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px" }}>
              <div style={{ padding: "14px", border: "1px solid var(--border-hairline)", borderRadius: "8px" }}>
                <strong>Append-Only Audit Journal</strong>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", marginTop: "4px" }}>
                  Financial passbooks are append-only to guarantee non-repudiation and cryptographic integrity.
                </p>
              </div>

              <div style={{ padding: "14px", border: "1px solid var(--border-hairline)", borderRadius: "8px" }}>
                <strong>NFS Caching vs HDFS Chunking</strong>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", marginTop: "4px" }}>
                  NFS uses client-side file caching with cache invalidation timeouts. HDFS breaks large end-of-day bank clearing dumps into 128MB chunks replicated 3x across data racks.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. SERVERLESS ARCHITECTURES */}
      {activeTab === "serverless" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Zap size={18} style={{ color: "var(--upi-orange)" }} />
                Serverless Architectures (Function-as-a-Service — FaaS)
              </div>
              <span className="status-pill success">Event-Driven Compute</span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              Serverless execution runs stateless compute containers on-demand in response to events (e.g. HTTP payment webhooks, database triggers, message queue arrivals). Cloud providers automatically handle horizontal autoscaling and charge strictly for execution time in milliseconds.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div style={{ padding: "16px", borderRadius: "10px", background: "var(--upi-green-tint)", border: "1px solid var(--upi-green-border)" }}>
                <h4 style={{ color: "var(--upi-green)", fontSize: "0.95rem", marginBottom: "6px" }}>
                  Advantages for Payment Workflows:
                </h4>
                <ul style={{ paddingLeft: "18px", fontSize: "0.82rem", color: "var(--ink-secondary)", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong>Instant Auto-Scaling:</strong> Handles sudden spikes (e.g. festival shopping flash sales) from 100 to 50,000 invocations per second without manual capacity provisioning.</li>
                  <li><strong>Zero Idle Cost:</strong> Banks pay nothing during low-traffic night hours.</li>
                  <li><strong>Decoupled Micro-Tasks:</strong> SMS notifications, soundbox voice alerts, and tax invoice generation execute in parallel serverless worker functions.</li>
                </ul>
              </div>

              <div style={{ padding: "16px", borderRadius: "10px", background: "var(--crimson-tint)", border: "1px solid var(--crimson-border)" }}>
                <h4 style={{ color: "var(--crimson)", fontSize: "0.95rem", marginBottom: "6px" }}>
                  Trade-offs & Challenges:
                </h4>
                <ul style={{ paddingLeft: "18px", fontSize: "0.82rem", color: "var(--ink-secondary)", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong>Cold Start Latency:</strong> Spinning up a fresh container can add 150–400ms delay, problematic for sub-second UPI SLA deadlines.</li>
                  <li><strong>Statelessness:</strong> Functions cannot maintain in-memory circuit breaker counts or connection pools; they must query external Redis or DynamoDB caches.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. CASE STUDIES */}
      {activeTab === "casestudies" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Building size={18} style={{ color: "var(--blue-accent)" }} />
                Industrial Case Studies: 5 Key Distributed Systems
              </div>
              <span className="status-pill info">Syllabus Requirements</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
              {(data?.caseStudies || []).map((cs, idx) => (
                <div key={idx} style={{ padding: "18px", borderRadius: "10px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <strong style={{ fontSize: "1.05rem", color: "var(--ink-primary)" }}>{cs.name}</strong>
                    <span className="status-pill info" style={{ fontSize: "0.72rem" }}>{cs.role}</span>
                  </div>
                  <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)", lineHeight: 1.5 }}>
                    {cs.upiRelevance}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 5. BLOCKCHAIN VS DISTRIBUTED DATABASES */}
      {activeTab === "tradeoffs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Layers size={18} style={{ color: "var(--upi-orange)" }} />
                Blockchain vs Modern Distributed Databases (Self Study)
              </div>
              <span className="status-pill warning">CAP & ACID vs BASE</span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              Financial architectures constantly navigate trade-offs between consistency, availability, latency, and decentralized trust.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px" }}>
              <div style={{ padding: "16px", border: "1px solid var(--border-hairline)", borderRadius: "10px", background: "#FFFFFF" }}>
                <span className="status-pill info" style={{ marginBottom: "8px" }}>CAP Theorem in UPI</span>
                <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)", lineHeight: 1.5 }}>
                  {data?.databaseTradeoffs?.capTheorem ||
                    "UPI prioritizes Consistency and Partition Tolerance (CP) over Availability for monetary debits, while switching to Availability (AP) for non-critical balance inquiry caching."}
                </p>
              </div>

              <div style={{ padding: "16px", border: "1px solid var(--border-hairline)", borderRadius: "10px", background: "#FFFFFF" }}>
                <span className="status-pill success" style={{ marginBottom: "8px" }}>ACID vs BASE</span>
                <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)", lineHeight: 1.5 }}>
                  {data?.databaseTradeoffs?.acidVsBase ||
                    "Traditional core banks mandate strict ACID guarantees. Scaled distributed UPI switches adopt Sagas and BASE with compensating rollbacks."}
                </p>
              </div>

              <div style={{ padding: "16px", border: "1px solid var(--border-hairline)", borderRadius: "10px", background: "#FFFFFF" }}>
                <span className="status-pill warning" style={{ marginBottom: "8px" }}>Blockchain / DLT vs Centralized UPI</span>
                <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)", lineHeight: 1.5 }}>
                  {data?.databaseTradeoffs?.blockchainComparison ||
                    "While Blockchain offers decentralized trustless consensus without a central authority, its latency (seconds to minutes) and low throughput (7-30 TPS) cannot match UPI's centralized NPCI clearing (>15,000 TPS with sub-second finality)."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
