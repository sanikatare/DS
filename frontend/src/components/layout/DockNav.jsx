import { NavLink } from "react-router-dom";
import {
  Network,
  Send,
  GitCommit,
  Radio,
  Zap,
  Share2,
} from "lucide-react";

export default function DockNav() {
  const items = [
    { to: "/", label: "01 TOPOLOGY", icon: Network },
    { to: "/transfer", label: "02 SIMULATOR", icon: Send },
    { to: "/ledger", label: "03 LEDGER", icon: GitCommit },
    { to: "/signals", label: "04 COMMUNICATION", icon: Radio },
    { to: "/chaos", label: "05 FAULT LAB", icon: Zap },
    { to: "/webrtc", label: "06 WEBRTC", icon: Share2 },
  ];

  return (
    <div className="dock-container">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) => `dock-item ${isActive ? "active" : ""}`}
          >
            <Icon size={16} />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </div>
  );
}
