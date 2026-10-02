// UPI Distributed Transaction Simulator - Optimised API & Shared WebSocket Multiplexer

const TXN_BASE = import.meta.env.VITE_TXN_API_URL || "";
const SENDER_BANK_BASE = import.meta.env.VITE_SENDER_BANK_URL || "/services/sender-bank";
const NPCI_BASE = import.meta.env.VITE_NPCI_URL || "/services/npci";
const RECEIVER_BANK_BASE = import.meta.env.VITE_RECEIVER_BANK_URL || "/services/receiver-bank";
const WS_PROTO = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
const WS_HOST = typeof window !== "undefined" ? window.location.host : "localhost:3000";
const WS_URL =
  import.meta.env.VITE_TXN_WS_URL ||
  (TXN_BASE ? TXN_BASE.replace(/^http/, "ws") + "/ws/transactions" : `${WS_PROTO}//${WS_HOST}/ws/transactions`);

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
  } catch {
    throw new Error(`Could not reach service at ${baseUrl}${path}. Is it running?`);
  }
  const data = await safeJson(res);
  if (!res.ok) {
    throw new Error(data.detail || `Request failed (${res.status})`);
  }
  return data;
}

/**
 * Single-trip atomic snapshot (replaces 7 separate HTTP calls with 1)
 */
export async function fetchSnapshot() {
  return request("/api/snapshot");
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

export async function resetSystem() {
  return request("/failure/reset-all", { method: "POST" });
}

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
// Unit III & IV Synchronization & Web Systems API Helpers
// ---------------------------------------------------------------------------

export async function fetchClocks() {
  return request("/api/synchronization/clocks");
}

export async function syncClocks() {
  return request("/api/synchronization/clocks/sync", { method: "POST" });
}

export async function introduceClockDrift(nodeId, driftMs) {
  return request("/api/synchronization/clocks/drift", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId, driftMs }),
  });
}

export async function resetClocks() {
  return request("/api/synchronization/clocks/reset", { method: "POST" });
}

export async function fetchLamportClocks() {
  return request("/api/synchronization/lamport");
}

export async function triggerLamportEvent(payload) {
  return request("/api/synchronization/lamport/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function resetLamportClocks() {
  return request("/api/synchronization/lamport/reset", { method: "POST" });
}

export async function fetchVectorClocks() {
  return request("/api/synchronization/vector");
}

export async function triggerVectorEvent(payload) {
  return request("/api/synchronization/vector/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function compareVectors(vectorA, vectorB) {
  return request("/api/synchronization/vector/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vectorA, vectorB }),
  });
}

export async function resetVectorClocks() {
  return request("/api/synchronization/vector/reset", { method: "POST" });
}

export async function fetchGlobalState() {
  return request("/api/synchronization/global-state");
}

export async function captureGlobalState() {
  return request("/api/synchronization/global-state/capture", { method: "POST" });
}

export async function fetchBeacons() {
  return request("/api/synchronization/beacons");
}

export async function pulseBeacon(nodeId) {
  return request("/api/synchronization/beacons/pulse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId }),
  });
}

export async function fetchArchitecture() {
  return request("/api/synchronization/architecture");
}

// ---------------------------------------------------------------------------
// Shared Singleton Multiplexed WebSocket Manager
// Prevents reconnect churn across route navigation & coalesces heartbeats
// ---------------------------------------------------------------------------
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 12000;
const HEARTBEAT_INTERVAL_MS = 15000;

let sharedWs = null;
let sharedStatus = "connecting";
let sharedLastSeq = 0;
let sharedAttempt = 0;
let reconnectTimer = null;
let heartbeatTimer = null;

const eventSubscribers = new Set();
const statusSubscribers = new Set();

function notifyStatus(nextStatus) {
  sharedStatus = nextStatus;
  statusSubscribers.forEach((cb) => {
    try {
      cb(sharedStatus);
    } catch {
      // ignore subscriber errors
    }
  });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
      try {
        sharedWs.send(JSON.stringify({ action: "ping" }));
      } catch {
        // ignore write error
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

function ensureSocketOpen() {
  if (
    sharedWs &&
    (sharedWs.readyState === WebSocket.OPEN || sharedWs.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  notifyStatus(sharedAttempt === 0 ? "connecting" : "reconnecting");
  const targetUrl =
    sharedLastSeq > 0 ? `${WS_URL}?lastSequence=${sharedLastSeq}` : WS_URL;
  sharedWs = new WebSocket(targetUrl);

  sharedWs.onopen = () => {
    sharedAttempt = 0;
    notifyStatus("connected");
    startHeartbeat();
  };

  sharedWs.onmessage = (msg) => {
    try {
      const payload = JSON.parse(msg.data);
      if (payload.sequence && payload.sequence > sharedLastSeq) {
        sharedLastSeq = payload.sequence;
      }
      eventSubscribers.forEach((cb) => {
        try {
          cb(payload);
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore malformed frames
    }
  };

  sharedWs.onclose = () => {
    stopHeartbeat();
    sharedWs = null;
    if (eventSubscribers.size === 0 && statusSubscribers.size === 0) {
      notifyStatus("disconnected");
      return;
    }
    notifyStatus("reconnecting");
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** sharedAttempt, RECONNECT_MAX_DELAY_MS);
    sharedAttempt += 1;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(ensureSocketOpen, delay);
  };

  sharedWs.onerror = () => {
    // onclose handles retry
  };
}

export function connectTransactionSocket(onEvent, onStatusChange) {
  if (onEvent) eventSubscribers.add(onEvent);
  if (onStatusChange) {
    statusSubscribers.add(onStatusChange);
    onStatusChange(sharedStatus);
  }

  ensureSocketOpen();

  return {
    close() {
      if (onEvent) eventSubscribers.delete(onEvent);
      if (onStatusChange) statusSubscribers.delete(onStatusChange);
    },
    requestReplay(seq) {
      if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
        sharedWs.send(
          JSON.stringify({ action: "replay", lastSequence: seq || sharedLastSeq })
        );
      }
    },
    sendPing() {
      if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
        sharedWs.send(JSON.stringify({ action: "ping" }));
      }
    },
  };
}
