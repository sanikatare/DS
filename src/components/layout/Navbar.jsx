import { NavLink, Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { resetSystem } from "../../api";
import { RefreshCw, Zap, BookOpen, Receipt, Radio } from "lucide-react";

export default function Navbar() {
  const navigate = useNavigate();
  const [resetting, setResetting] = useState(false);

  const navItems = [
    { to: "/", label: "Dashboard", end: true },
    { to: "/ledger", label: "Ledger" },
    { to: "/transactions", label: "Transactions" },
    { to: "/webrtc-stream", label: "WebRTC & Stream" },
    { to: "/unit1", label: "Unit I" },
    { to: "/unit2", label: "Unit II" },
    { to: "/unit3", label: "Unit III" },
    { to: "/unit4", label: "Unit IV" },
  ];

  async function handleResetSystem() {
    setResetting(true);
    try {
      await resetSystem();
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => setResetting(false), 500);
    }
  }

  return (
    <header className="top-bar">
      <Link to="/" className="brand-wordmark" title="UPI Distributed Systems Simulator">
        <div className="upi-logo-mark" aria-hidden="true">
          <span className="upi-arrow-orange"></span>
          <span className="upi-arrow-green"></span>
        </div>
        <span className="brand-text">UPI</span>
        <span className="brand-badge">Distributed Systems</span>
      </Link>

      <nav className="top-nav-links" aria-label="Main Navigation">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `top-nav-link ${isActive ? "active" : ""}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="top-bar-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={handleResetSystem}
          disabled={resetting}
          title="Reset all simulated faults and circuit breakers"
        >
          <RefreshCw size={14} className={resetting ? "spin" : ""} style={{ color: "var(--upi-green)" }} />
          Reset System
        </button>

        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate("/transactions")}
          title="Go to Transactions"
        >
          <Zap size={14} />
          Pay ₹
        </button>
      </div>
    </header>
  );
}
