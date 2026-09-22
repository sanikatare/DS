import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import NetworkView from "./pages/NetworkView";
import TransferView from "./pages/TransferView";
import LedgerView from "./pages/LedgerView";
import SignalsView from "./pages/SignalsView";
import ChaosView from "./pages/ChaosView";
import WebRTCView from "./pages/WebRTCView";
import "./styles.css";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<NetworkView />} />
        <Route path="/transfer" element={<TransferView />} />
        <Route path="/ledger" element={<LedgerView />} />
        <Route path="/signals" element={<SignalsView />} />
        <Route path="/chaos" element={<ChaosView />} />
        <Route path="/webrtc" element={<WebRTCView />} />
        <Route path="*" element={<NetworkView />} />
      </Routes>
    </Router>
  );
}

export default App;
