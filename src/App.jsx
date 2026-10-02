import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import DashboardView from "./pages/DashboardView";
import LedgerView from "./pages/LedgerView";
import TransactionsView from "./pages/TransactionsView";
import WebRTCStreamView from "./pages/WebRTCStreamView";
import Unit1View from "./pages/Unit1View";
import Unit2View from "./pages/Unit2View";
import Unit3View from "./pages/Unit3View";
import Unit4View from "./pages/Unit4View";
import "./styles.css";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<DashboardView />} />
        <Route path="/ledger" element={<LedgerView />} />
        <Route path="/transactions" element={<TransactionsView />} />
        <Route path="/webrtc-stream" element={<WebRTCStreamView />} />
        <Route path="/unit1" element={<Unit1View />} />
        <Route path="/unit2" element={<Unit2View />} />
        <Route path="/unit3" element={<Unit3View />} />
        <Route path="/unit4" element={<Unit4View />} />

        {/* Alias routes for convenience */}
        <Route path="/dashboard" element={<DashboardView />} />
        <Route path="/webrtc" element={<WebRTCStreamView />} />
        <Route path="/websocket" element={<WebRTCStreamView />} />
        <Route path="/introduction" element={<Unit1View />} />
        <Route path="/communication" element={<Unit2View />} />
        <Route path="/synchronization" element={<Unit3View />} />
        <Route path="/paradigms" element={<Unit4View />} />
        <Route path="*" element={<DashboardView />} />
      </Routes>
    </Router>
  );
}

export default App;
