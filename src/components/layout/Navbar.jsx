import { NavLink, Link, useNavigate } from "react-router-dom";

export default function Navbar() {
  const navigate = useNavigate();

  const navItems = [
    { to: "/", label: "Topology", end: true },
    { to: "/transfer", label: "Transfer" },
    { to: "/ledger", label: "Passbook" },
    { to: "/synchronization", label: "Synchronization" },
    { to: "/chaos", label: "Faults" },
    { to: "/signals", label: "Stream" },
  ];

  return (
    <header className="top-bar">
      <Link to="/" className="brand-wordmark">
        BharatUPI
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
          onClick={() => navigate("/webrtc")}
        >
          WebRTC P2P
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate("/transfer")}
        >
          Pay ₹
        </button>
      </div>
    </header>
  );
}
