import { Radio } from "lucide-react";

export default function Navbar({ connStatus = "connected" }) {
  const isHealthy = connStatus === "connected";

  return (
    <header className="top-bar">
      <div className="brand-identity">
        <div className="brand-mark">UPI</div>
        <span className="brand-title">UPI DISTRIBUTED SIMULATOR</span>
        <span className="brand-subtitle">DISTRIBUTED SYSTEMS FA-1 MINI PROJECT</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          className="font-mono"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: "0.75rem",
            fontWeight: 800,
            color: isHealthy ? "var(--green-success)" : "var(--orange-primary)",
            background: isHealthy ? "var(--green-light)" : "var(--orange-light)",
            padding: "4px 14px",
            borderRadius: "var(--radius-pill)",
          }}
        >
          <Radio size={14} />
          <span>{isHealthy ? "● SYSTEM OPERATIONAL" : "CONNECTING GATEWAY..."}</span>
        </div>
      </div>
    </header>
  );
}
