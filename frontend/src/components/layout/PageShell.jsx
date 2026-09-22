import Navbar from "./Navbar";
import DockNav from "./DockNav";

export default function PageShell({ children, connStatus = "connected" }) {
  return (
    <div className="app-viewport">
      <Navbar connStatus={connStatus} />
      <DockNav />
      <main className="main-canvas">{children}</main>
    </div>
  );
}
