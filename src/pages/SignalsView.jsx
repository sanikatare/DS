import { useEffect, useState, useRef } from "react";
import PageShell from "../components/layout/PageShell";
import {
  connectTransactionSocket,
  fetchTransactions,
  fetchWebSocketStats,
  initiateTransaction,
} from "../api";
import { RefreshCw, Send } from "lucide-react";

export default function SignalsView() {
  const [events, setEvents] = useState([]);
  const [connStatus, setConnStatus] = useState("connecting");
  const [latestSeq, setLatestSeq] = useState(0);
  const [filterQuery, setFilterQuery] = useState("");
  const [triggeringMode, setTriggeringMode] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    fetchTransactions()
      .then((txns) => {
        const allEvts = (txns || []).flatMap((t) =>
          (t.timeline || []).map((e, idx) => ({
            ...e,
            sequence: e.sequence || idx + 1,
            transactionId: t.transactionId,
          }))
        );
        allEvts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        setEvents(allEvts);
        const maxSeq = allEvts.reduce((max, e) => Math.max(max, e.sequence || 0), 0);
        if (maxSeq > 0) setLatestSeq((prev) => Math.max(prev, maxSeq));
      })
      .catch(() => {});

    fetchWebSocketStats()
      .then((s) => {
        if (s && s.totalSequence) setLatestSeq((prev) => Math.max(prev, s.totalSequence));
      })
      .catch(() => {});

    const ws = connectTransactionSocket((evt) => {
      if (evt.sequence) setLatestSeq((prev) => Math.max(prev, evt.sequence));
      setEvents((prev) => [evt, ...prev]);
    }, setConnStatus);

    socketRef.current = ws;
    return () => ws.close();
  }, []);

  async function handleQuickProtocolRun(mode) {
    setTriggeringMode(mode);
    try {
      await initiateTransaction({
        senderId: "sanika@bank",
        receiverId: "navya@bank",
        amount: 250,
        idempotencyKey: `STREAM-${mode.toUpperCase()}-${Date.now()}`,
        mode,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setTriggeringMode(null);
    }
  }

  const filteredEvents = events.filter((ev) => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    return (
      (ev.eventType || ev.event || "").toLowerCase().includes(q) ||
      (ev.service || ev.source || "").toLowerCase().includes(q) ||
      (ev.transactionId || "").toLowerCase().includes(q)
    );
  });

  return (
    <PageShell connStatus={connStatus}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Event Stream</h1>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => socketRef.current?.sendPing()}
          >
            Ping
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => socketRef.current?.requestReplay(Math.max(1, latestSeq - 10))}
          >
            Replay 10
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setEvents([])}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="kpi-strip">
        <div className="kpi-cell">
          <span className="kpi-label">Socket</span>
          <span
            className="kpi-value"
            style={{ color: connStatus === "connected" ? "var(--emerald)" : "var(--saffron)" }}
          >
            {connStatus.toUpperCase()}
          </span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Frames</span>
          <span className="kpi-value">{events.length}</span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Sequence</span>
          <span className="kpi-value">#{latestSeq}</span>
        </div>
        <div className="kpi-cell">
          <span className="kpi-label">Buffer</span>
          <span className="kpi-value">500</span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { id: "rest", label: "+ REST Pulse" },
            { id: "grpc", label: "+ gRPC Pulse" },
            { id: "rabbitmq", label: "+ AMQP Pulse" },
            { id: "p2p", label: "+ P2P Pulse" },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn-secondary"
              disabled={triggeringMode !== null}
              onClick={() => handleQuickProtocolRun(p.id)}
            >
              {triggeringMode === p.id ? <RefreshCw size={13} className="spin" /> : <Send size={13} />}
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        <input
          type="search"
          className="field-input font-mono"
          style={{ maxWidth: 260 }}
          placeholder="Filter stream..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
        />
      </div>

      <div className="surface-panel" style={{ padding: 0, overflow: "hidden" }}>
        {filteredEvents.length === 0 ? (
          <div style={{ padding: 44, textAlign: "center", color: "var(--ink-muted)" }}>
            Stream empty. Trigger a pulse above.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Seq</th>
                <th style={{ width: 110 }}>Time</th>
                <th style={{ width: 200 }}>Service</th>
                <th style={{ width: 240 }}>Signal</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((ev, idx) => {
                const evtName = ev.eventType || ev.event || "SIGNAL";
                const isSuccess =
                  evtName.includes("SUCCESS") ||
                  evtName.includes("COMPLETED") ||
                  evtName.includes("VERIFIED") ||
                  evtName.includes("ROUTED") ||
                  evtName === "PONG";
                const isFailed =
                  evtName.includes("FAILED") ||
                  evtName.includes("FAILURE") ||
                  evtName.includes("FAST_FAIL");

                return (
                  <tr key={idx}>
                    <td className="font-mono tabular-nums" style={{ fontWeight: 600, color: "var(--saffron)" }}>
                      #{ev.sequence || "-"}
                    </td>
                    <td className="font-mono tabular-nums" style={{ fontSize: "0.76rem", color: "var(--ink-muted)" }}>
                      {new Date(ev.timestamp || Date.now()).toLocaleTimeString()}
                    </td>
                    <td style={{ fontWeight: 600 }}>{ev.service || ev.source || "Hub"}</td>
                    <td>
                      <span
                        className={`status-text ${
                          isSuccess
                            ? "status-nominal"
                            : isFailed
                            ? "status-critical"
                            : "status-warning"
                        }`}
                      >
                        {isSuccess ? "●" : isFailed ? "▲" : "○"} {evtName}
                      </span>
                    </td>
                    <td className="font-mono" style={{ color: "var(--ink-secondary)", fontSize: "0.78rem" }}>
                      {ev.transactionId && ev.transactionId !== "SYS-GLOBAL"
                        ? ev.transactionId
                        : ev.message || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  );
}
