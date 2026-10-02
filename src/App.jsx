import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import NetworkView from "./pages/NetworkView";
import TransferView from "./pages/TransferView";
import LedgerView from "./pages/LedgerView";
import SignalsView from "./pages/SignalsView";
import ChaosView from "./pages/ChaosView";
import WebRTCView from "./pages/WebRTCView";
import DashboardView from "./pages/DashboardView";
import SynchronizationView from "./pages/SynchronizationView";
import "./styles.css";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<NetworkView />} />
        <Route path="/transfer" element={<TransferView />} />
        <Route path="/ledger" element={<LedgerView />} />
        <Route path="/synchronization" element={<SynchronizationView />} />
        <Route path="/signals" element={<SignalsView />} />
        <Route path="/chaos" element={<ChaosView />} />
        <Route path="/webrtc" element={<WebRTCView />} />
        <Route path="/dashboard" element={<DashboardView />} />
        <Route path="*" element={<NetworkView />} />
      </Routes>
    </Router>
  );
}

export default App;
