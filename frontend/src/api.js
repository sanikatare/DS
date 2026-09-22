// UPI Distributed Transaction Simulator - API helpers
// Each backend service is called directly on its own port, matching the
// project's "independent services on independent ports" design.

const TXN_BASE = import.meta.env.VITE_TXN_API_URL || "http://localhost:8000";
const SENDER_BANK_BASE = import.meta.env.VITE_SENDER_BANK_URL || "http://localhost:8001";
const NPCI_BASE = import.meta.env.VITE_NPCI_URL || "http://localhost:8002";
const RECEIVER_BANK_BASE = import.meta.env.VITE_RECEIVER_BANK_URL || "http://localhost:8003";
const WS_URL = import.meta.env.VITE_TXN_WS_URL || TXN_BASE.replace(/^http/, "ws") + "/ws/transactions";

async function safeJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function request(path, options, baseUrl = TXN_BASE) {
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, options);
  } catch (err) {
    throw new Error(`Could not reach service at ${baseUrl}${path}. Is it running?`);
  }
  const data = await safeJson(res);
  if (!res.ok) {
    throw new Error(data.detail || `Request failed (${res.status})`);
  }
  return data;
}

export async function fetchUsers() {
  const data = await request("/api/users");
  return data.users;
}

export async function initiateTransaction({ senderId, receiverId, amount, idempotencyKey, mode }) {
  return request("/api/transaction/initiate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senderId, receiverId, amount, idempotencyKey, mode }),
  });
}

export async function fetchTransactions() {
  const data = await request("/api/transactions");
  return data.transactions;
}

export async function fetchStats() {
  return request("/api/stats");
}

export async function fetchWebSocketStats() {
  return request("/api/websocket/stats");
}


export async function fetchFailureStatus() {
  return request("/failure/status");
}

export async function toggleFailure(target, enable) {
  return request(`/failure/${target}/${enable ? "enable" : "disable"}`, { method: "POST" });
}

export async function resetCircuitBreakers() {
  return request("/api/circuit-breaker/reset", { method: "POST" });
}

const ALL_FAILURE_TARGETS = ["sender-bank", "npci", "receiver-bank", "timeout"];

export async function resetSystem() {
  const results = await Promise.allSettled(
    ALL_FAILURE_TARGETS.map((target) => toggleFailure(target, false))
  );
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw new Error("Could not reset all failure simulations.");
  return fetchFailureStatus();
}

/**
 * Real HTTP health checks across independent ports
 */
export async function checkHealth(baseUrl, name, port) {
  try {
    const res = await fetch(`${baseUrl}/health`);
    if (res.ok) {
      return { service: name, port, status: "healthy" };
    }
    return { service: name, port, status: "unhealthy" };
  } catch {
    return { service: name, port, status: "offline" };
  }
}

export async function fetchAllServicesHealth() {
  const [txn, sender, npci, receiver] = await Promise.all([
    checkHealth(TXN_BASE, "Transaction Service", "8000"),
    checkHealth(SENDER_BANK_BASE, "Sender Bank Service", "8001"),
    checkHealth(NPCI_BASE, "NPCI Simulator", "8002"),
    checkHealth(RECEIVER_BANK_BASE, "Receiver Bank Service", "8003"),
  ]);
  return {
    "transaction-service": txn,
    "sender-bank": sender,
    "npci": npci,
    "receiver-bank": receiver,
  };
}

// ---------------------------------------------------------------------------
// WebSocket connection with automatic reconnection & stream recovery (Phase 4)
// ---------------------------------------------------------------------------
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
const HEARTBEAT_INTERVAL_MS = 15000;

export function connectTransactionSocket(onEvent, onStatusChange) {
  let ws = null;
  let closedByClient = false;
  let attempt = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let lastSequence = 0;

  function setStatus(status) {
    if (onStatusChange) onStatusChange(status);
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ action: "ping" }));
        } catch {
          // Ignore write error
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function open() {
    setStatus(attempt === 0 ? "connecting" : "reconnecting");
    const targetUrl = lastSequence > 0 ? `${WS_URL}?lastSequence=${lastSequence}` : WS_URL;
    ws = new WebSocket(targetUrl);

    ws.onopen = () => {
      attempt = 0;
      setStatus("connected");
      startHeartbeat();
    };

    ws.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data);
        if (payload.sequence && payload.sequence > lastSequence) {
          lastSequence = payload.sequence;
        }
        onEvent(payload);
      } catch (err) {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      stopHeartbeat();
      if (closedByClient) return;
      setStatus("disconnected");
      const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
      attempt += 1;
      reconnectTimer = setTimeout(open, delay);
    };

    ws.onerror = () => {
      // onclose handles reconnection
    };
  }

  open();

  return {
    close() {
      closedByClient = true;
      stopHeartbeat();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    },
    requestReplay(seq) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "replay", lastSequence: seq || lastSequence }));
      }
    },
    sendPing() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "ping" }));
      }
    },
  };
}
