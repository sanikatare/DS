import express, { Request, Response } from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import {
  ClockSyncManager,
  LamportClockManager,
  VectorClockManager,
  BeaconProtocolManager,
  GlobalStateManager,
  VectorClock,
} from "./src/server/synchronization.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 2);
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_SECONDS || 0.4) * 1000;
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_SECONDS || 3) * 1000;
const CB_FAILURE_THRESHOLD = Number(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || 3);
const CB_RECOVERY_TIMEOUT_SEC = Number(process.env.CIRCUIT_BREAKER_RECOVERY_TIMEOUT || 10);
const CB_SUCCESS_THRESHOLD = Number(process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD || 1);

// ---------------------------------------------------------------------------
// In-Memory State (Users, Transactions, Debits, Credits, Failure Simulation)
// ---------------------------------------------------------------------------

interface UserRecord {
  id: string;
  name: string;
  upi_id: string;
  bank_name: string;
  balance: number;
  created_at: string;
}

interface TimelineEvent {
  event: string;
  service: string;
  message: string;
  timestamp: string;
  sequence?: number;
  [key: string]: any;
}

interface TransactionRecord {
  transactionId: string;
  senderId: string;
  receiverId: string;
  amount: number;
  status: string;
  failureReason: string | null;
  idempotencyKey: string | null;
  mode?: string;
  timeline: TimelineEvent[];
  createdAt: string;
  updatedAt: string;
}

const nowIso = () => new Date().toISOString();

const USERS_MAP = new Map<string, UserRecord>();

function seedUsers() {
  const initial: Omit<UserRecord, "created_at">[] = [
    { id: "usr_sanika", name: "Sanika", upi_id: "sanika@bank", bank_name: "HDFC Bank", balance: 10000.0 },
    { id: "usr_navya", name: "Navya", upi_id: "navya@bank", bank_name: "ICICI Bank", balance: 5000.0 },
    { id: "usr_rahul", name: "Rahul", upi_id: "rahul@bank", bank_name: "SBI Bank", balance: 7500.0 },
    { id: "usr_priya", name: "Priya", upi_id: "priya@bank", bank_name: "Axis Bank", balance: 12000.0 },
    { id: "usr_saba", name: "Saba", upi_id: "saba@bank", bank_name: "SBI Bank", balance: 7500.0 },
    { id: "usr_manaswi", name: "Manaswi", upi_id: "manaswi@bank", bank_name: "Axis Bank", balance: 12000.0 },
    { id: "usr_sai", name: "Sai", upi_id: "sai@bank", bank_name: "PNB Bank", balance: 15000.0 },
  ];
  for (const u of initial) {
    USERS_MAP.set(u.upi_id, { ...u, created_at: nowIso() });
  }
}
seedUsers();

function listUsers() {
  return Array.from(USERS_MAP.values()).map((u) => ({
    id: u.id,
    name: u.name,
    upi_id: u.upi_id,
    bank: u.bank_name,
    bank_name: u.bank_name,
    balance: u.balance,
  }));
}

function getUserByIdOrUpi(identifier: string): UserRecord | null {
  if (!identifier) return null;
  let clean = identifier.trim();
  if (clean.includes("/")) {
    const parts = clean.split("/").map((p) => p.trim());
    for (let i = parts.length - 1; i >= 0; i--) {
      const found = getUserByIdOrUpi(parts[i]);
      if (found) return found;
    }
    clean = parts[parts.length - 1];
  }
  const lower = clean.toLowerCase();
  for (const u of USERS_MAP.values()) {
    if (
      u.id.toLowerCase() === lower ||
      u.upi_id.toLowerCase() === lower ||
      u.name.toLowerCase() === lower ||
      u.upi_id.split("@")[0].toLowerCase() === lower.replace(/^usr_/, "").split("@")[0]
    ) {
      return u;
    }
  }
  // Auto-provision dynamic user if not in seed list so any name/UPI works seamlessly
  const base = lower.replace(/^usr_/, "").split("@")[0] || "user";
  const upi = clean.includes("@") ? lower : `${base}@bank`;
  const displayName = base.charAt(0).toUpperCase() + base.slice(1);
  const created: UserRecord = {
    id: `usr_${base}`,
    name: displayName,
    upi_id: upi,
    bank_name: "HDFC Bank",
    balance: 10000.0,
    created_at: nowIso(),
  };
  USERS_MAP.set(upi, created);
  return created;
}

const TRANSACTIONS = new Map<string, TransactionRecord>();
const IDEMPOTENCY_INDEX = new Map<string, string>();
const SENDER_DEBITS = new Map<string, { senderUpi: string; amount: number }>();
const RECEIVER_CREDITS = new Map<string, string>();

function seedInitialTransactions() {
  const now = Date.now();
  const samples = [
    {
      id: "TXN-20260927-IMPS01",
      sender: "sanika@bank",
      receiver: "navya@bank",
      amount: 1250,
      key: "UPI-INIT-90812",
      mode: "rest",
      offsetMs: 180000,
    },
    {
      id: "TXN-20260927-IMPS02",
      sender: "priya@bank",
      receiver: "rahul@bank",
      amount: 2400,
      key: "UPI-INIT-90813",
      mode: "grpc",
      offsetMs: 90000,
    },
  ];

  for (const s of samples) {
    const t0 = new Date(now - s.offsetMs).toISOString();
    const t1 = new Date(now - s.offsetMs + 45).toISOString();
    const t2 = new Date(now - s.offsetMs + 110).toISOString();
    const t3 = new Date(now - s.offsetMs + 190).toISOString();
    const t4 = new Date(now - s.offsetMs + 260).toISOString();

    const txn: TransactionRecord = {
      transactionId: s.id,
      senderId: s.sender,
      receiverId: s.receiver,
      amount: s.amount,
      status: "SUCCESS",
      failureReason: null,
      idempotencyKey: s.key,
      mode: s.mode,
      createdAt: t0,
      updatedAt: t4,
      timeline: [
        {
          event: "TRANSACTION_INITIATED",
          service: "Transaction Service",
          message: `Payment request received and validated (Protocol: ${s.mode.toUpperCase()})`,
          timestamp: t0,
        },
        {
          event: "SENDER_BANK_PROCESSING",
          service: "Sender Bank Service",
          message: `Validating sender account and checking available balance (${s.mode.toUpperCase()})`,
          timestamp: t1,
        },
        {
          event: "SENDER_VERIFIED",
          service: "Sender Bank Service",
          message: `Sender account verified & debited successfully (${s.mode.toUpperCase()})`,
          timestamp: t1,
        },
        {
          event: "NPCI_PROCESSING",
          service: "NPCI Simulator Service",
          message: `Routing transaction across interbank switch (${s.mode.toUpperCase()})`,
          timestamp: t2,
        },
        {
          event: "NPCI_ROUTED",
          service: "NPCI Simulator Service",
          message: `NPCI switch routed request to receiver bank (${s.mode.toUpperCase()})`,
          timestamp: t2,
        },
        {
          event: "RECEIVER_BANK_PROCESSING",
          service: "Receiver Bank Service",
          message: `Processing credit to beneficiary account (${s.mode.toUpperCase()})`,
          timestamp: t3,
        },
        {
          event: "PAYMENT_SUCCESS",
          service: "Transaction Service",
          message: `Transaction successfully completed and settled (${s.mode.toUpperCase()})`,
          timestamp: t4,
        },
      ],
    };

    TRANSACTIONS.set(s.id, txn);
    IDEMPOTENCY_INDEX.set(s.key, s.id);
  }
}
seedInitialTransactions();

const FAILURE_STATE = {
  sender_bank_failure: false,
  npci_failure: false,
  receiver_bank_failure: false,
  timeout_simulation: false,
};

const FRIENDLY_TO_TARGET: Record<string, keyof typeof FAILURE_STATE> = {
  "sender-bank": "sender_bank_failure",
  npci: "npci_failure",
  "receiver-bank": "receiver_bank_failure",
};

// ---------------------------------------------------------------------------
// Circuit Breaker Implementation
// ---------------------------------------------------------------------------

enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

class CircuitBreaker {
  name: string;
  failureThreshold: number;
  recoveryTimeout: number;
  successThreshold: number;
  private _state: CircuitState = CircuitState.CLOSED;
  private _failureCount = 0;
  private _consecutiveSuccesses = 0;
  private _lastStateChange: Date = new Date();

  constructor(
    name: string,
    failureThreshold = CB_FAILURE_THRESHOLD,
    recoveryTimeout = CB_RECOVERY_TIMEOUT_SEC,
    successThreshold = CB_SUCCESS_THRESHOLD
  ) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
    this.successThreshold = successThreshold;
  }

  get state(): CircuitState {
    if (this._state === CircuitState.OPEN) {
      const elapsedSec = (Date.now() - this._lastStateChange.getTime()) / 1000;
      if (elapsedSec >= this.recoveryTimeout) {
        return CircuitState.HALF_OPEN;
      }
    }
    return this._state;
  }

  async canExecute(): Promise<boolean> {
    const current = this.state;
    if (current === CircuitState.HALF_OPEN && this._state === CircuitState.OPEN) {
      await this.setState(
        CircuitState.HALF_OPEN,
        `Recovery timeout (${this.recoveryTimeout}s) elapsed. Entering trial state.`
      );
      return true;
    }
    if (this._state === CircuitState.OPEN) {
      return false;
    }
    return true;
  }

  async recordSuccess() {
    const current = this.state;
    if (current === CircuitState.HALF_OPEN || this._state === CircuitState.HALF_OPEN) {
      this._consecutiveSuccesses += 1;
      if (this._consecutiveSuccesses >= this.successThreshold) {
        this._failureCount = 0;
        this._consecutiveSuccesses = 0;
        await this.setState(
          CircuitState.CLOSED,
          `Trial request succeeded (${this.successThreshold} success). Service recovered.`
        );
      }
    } else if (this._state === CircuitState.CLOSED) {
      this._failureCount = 0;
    }
  }

  async recordFailure() {
    const current = this.state;
    if (current === CircuitState.HALF_OPEN || this._state === CircuitState.HALF_OPEN) {
      this._failureCount = this.failureThreshold;
      this._consecutiveSuccesses = 0;
      await this.setState(
        CircuitState.OPEN,
        "Trial request failed in HALF_OPEN state. Re-opening circuit."
      );
    } else if (this._state === CircuitState.CLOSED) {
      this._failureCount += 1;
      if (this._failureCount >= this.failureThreshold) {
        await this.setState(
          CircuitState.OPEN,
          `Failure threshold (${this.failureThreshold}) reached. Circuit opened.`
        );
      }
    }
  }

  private async setState(newState: CircuitState, reason: string) {
    const oldState = this._state;
    if (oldState === newState) return;
    this._state = newState;
    this._lastStateChange = new Date();
    broadcastStreamEvent({
      event: "CIRCUIT_BREAKER_STATE_CHANGE",
      service: this.name,
      oldState,
      newState,
      reason,
    });
  }

  async reset() {
    this._failureCount = 0;
    this._consecutiveSuccesses = 0;
    await this.setState(CircuitState.CLOSED, "Manual reset triggered");
  }

  getStatusDict() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this._failureCount,
      failureThreshold: this.failureThreshold,
      recoveryTimeout: this.recoveryTimeout,
      successThreshold: this.successThreshold,
      lastStateChange: this._lastStateChange.toISOString(),
    };
  }
}

const circuitBreakers: Record<string, CircuitBreaker> = {
  "sender-bank": new CircuitBreaker("Sender Bank Service"),
  npci: new CircuitBreaker("NPCI Simulator Service"),
  "receiver-bank": new CircuitBreaker("Receiver Bank Service"),
};

function getBreakerByLabel(serviceLabel: string): CircuitBreaker {
  if (serviceLabel.toLowerCase().includes("sender")) return circuitBreakers["sender-bank"];
  if (serviceLabel.toLowerCase().includes("npci")) return circuitBreakers["npci"];
  if (serviceLabel.toLowerCase().includes("receiver")) return circuitBreakers["receiver-bank"];
  if (!circuitBreakers[serviceLabel]) {
    circuitBreakers[serviceLabel] = new CircuitBreaker(serviceLabel);
  }
  return circuitBreakers[serviceLabel];
}

function getAllCircuitBreakerStatuses() {
  const result: Record<string, any> = {};
  for (const [k, cb] of Object.entries(circuitBreakers)) {
    result[k] = cb.getStatusDict();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Unit III & IV Synchronization Singletons
// ---------------------------------------------------------------------------
const clockSyncManager = new ClockSyncManager();
const lamportManager = new LamportClockManager();
const vectorManager = new VectorClockManager();
const beaconManager = new BeaconProtocolManager();
const globalStateManager = new GlobalStateManager();

function getServiceNodeId(serviceName: string): string {
  const lower = serviceName.toLowerCase();
  if (lower.includes("sender")) return "sender-bank";
  if (lower.includes("npci")) return "npci";
  if (lower.includes("receiver")) return "receiver-bank";
  return "transaction-service";
}

// ---------------------------------------------------------------------------
// WebSocket Stream Manager (/ws/transactions) & WebRTC Signaling (/ws/webrtc)
// ---------------------------------------------------------------------------

const MAX_STREAM_BUFFER_SIZE = 500;
let sequenceCounter = 0;
const streamBuffer: any[] = [];
const streamClients = new Set<WebSocket>();

function broadcastStreamEvent(rawEvent: Record<string, any>) {
  sequenceCounter += 1;
  const timestamp = nowIso();
  const eventId = `EVT-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const srcNode = getServiceNodeId(rawEvent.service || rawEvent.source || "transaction-service");
  const lamport = rawEvent.lamport ?? lamportManager.getClock(srcNode);
  const vector = rawEvent.vector ?? vectorManager.getVector(srcNode);

  const formatted = {
    eventId,
    sequence: sequenceCounter,
    transactionId: rawEvent.transactionId || rawEvent.txnId || "SYS-GLOBAL",
    eventType: rawEvent.event || rawEvent.eventType || "GENERIC_SIGNAL",
    event: rawEvent.event || rawEvent.eventType || "GENERIC_SIGNAL",
    timestamp,
    source: rawEvent.service || rawEvent.source || "transaction-service",
    service: rawEvent.service || rawEvent.source || "transaction-service",
    status: rawEvent.status || "PROCESSING",
    message: rawEvent.message || rawEvent.reason || rawEvent.event || "",
    lamport,
    vector,
    ...rawEvent,
    payload: rawEvent,
  };

  streamBuffer.push(formatted);
  if (streamBuffer.length > MAX_STREAM_BUFFER_SIZE) {
    streamBuffer.shift();
  }

  const msgText = JSON.stringify(formatted);
  for (const client of Array.from(streamClients)) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(msgText);
      } catch {
        streamClients.delete(client);
      }
    } else if (client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING) {
      streamClients.delete(client);
    }
  }

  return formatted;
}

function replayMissedEvents(ws: WebSocket, lastSequence: number) {
  if (lastSequence <= 0 || streamBuffer.length === 0) return 0;
  const minBuffered = streamBuffer[0]?.sequence ?? 0;
  if (lastSequence < minBuffered - 1) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          event: "STREAM_MISSED_RECOVERY_EXPIRED",
          eventType: "STREAM_MISSED_RECOVERY_EXPIRED",
          timestamp: nowIso(),
          message: `Requested sequence ${lastSequence} is older than replay buffer (min seq: ${minBuffered})`,
          sequence: sequenceCounter,
        })
      );
    }
    return 0;
  }
  let count = 0;
  for (const ev of streamBuffer) {
    if ((ev.sequence || 0) > lastSequence && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(ev));
      count++;
    }
  }
  return count;
}

function getStreamStats() {
  return {
    activeClients: streamClients.size,
    totalSequence: sequenceCounter,
    bufferedEvents: streamBuffer.length,
    maxBufferSize: MAX_STREAM_BUFFER_SIZE,
  };
}

// WebRTC Signaling state
const webrtcRooms = new Map<string, Map<string, WebSocket>>();
const webrtcPeerMeta = new Map<WebSocket, { roomId: string; peerId: string }>();

function getWebRTCRoomPeers(roomId: string): string[] {
  const room = webrtcRooms.get(roomId);
  return room ? Array.from(room.keys()) : [];
}

function getAllWebRTCRooms(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [rid, peers] of webrtcRooms.entries()) {
    out[rid] = Array.from(peers.keys());
  }
  return out;
}

function connectWebRTCPeer(ws: WebSocket, roomId: string, peerId: string): boolean {
  let room = webrtcRooms.get(roomId);
  if (!room) {
    room = new Map();
    webrtcRooms.set(roomId, room);
  }
  const existing = room.get(peerId);
  if (existing && existing !== ws && existing.readyState === WebSocket.OPEN) {
    return false;
  }
  room.set(peerId, ws);
  webrtcPeerMeta.set(ws, { roomId, peerId });
  return true;
}

function disconnectWebRTCSocket(ws: WebSocket): { roomId: string; peerId: string } | null {
  const meta = webrtcPeerMeta.get(ws);
  if (!meta) return null;
  webrtcPeerMeta.delete(ws);

  const { roomId, peerId } = meta;
  const room = webrtcRooms.get(roomId);
  if (room) {
    room.delete(peerId);
    const remainingPeers = Array.from(room.keys());
    const notifyMsg = JSON.stringify({
      type: "peer-left",
      roomId,
      peerId,
      peers: remainingPeers,
    });
    for (const targetWs of room.values()) {
      if (targetWs.readyState === WebSocket.OPEN) {
        try {
          targetWs.send(notifyMsg);
        } catch {
          // ignore
        }
      }
    }
    if (room.size === 0) {
      webrtcRooms.delete(roomId);
    }
  }
  return meta;
}

function routeWebRTCSignalingMessage(senderWs: WebSocket, payload: Record<string, any>) {
  const meta = webrtcPeerMeta.get(senderWs);
  if (!meta) return;
  const { roomId, peerId: senderPeerId } = meta;
  const room = webrtcRooms.get(roomId);
  if (!room) return;

  const forwardPayload = JSON.stringify({
    ...payload,
    roomId,
    peerId: senderPeerId,
  });

  const targetPeerId = payload.targetPeerId;
  if (targetPeerId && room.has(targetPeerId)) {
    const targetWs = room.get(targetPeerId)!;
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(forwardPayload);
    }
  } else {
    for (const [pid, targetWs] of room.entries()) {
      if (pid !== senderPeerId && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(forwardPayload);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Simulated Downstream Microservice Operations & Retry Wrapper
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function recordTimeline(
  txn: TransactionRecord,
  eventType: string,
  serviceName = "Transaction Service",
  message = "",
  extra: Record<string, any> = {}
) {
  const timestamp = nowIso();
  const nodeId = getServiceNodeId(serviceName);
  const lamport = extra.lamport ?? lamportManager.getClock(nodeId);
  const vector = extra.vector ?? vectorManager.getVector(nodeId);

  const entry: TimelineEvent = {
    event: eventType,
    service: serviceName,
    message: message || extra.reason || extra.detail || eventType.replace(/_/g, " "),
    timestamp,
    lamport,
    vector,
    ...extra,
  };
  txn.timeline.push(entry);
  txn.updatedAt = timestamp;
}

function setStatus(txn: TransactionRecord, status: string, failureReason: string | null = null) {
  txn.status = status;
  if (failureReason !== null) {
    txn.failureReason = failureReason;
  }
  txn.updatedAt = nowIso();
}

async function simulateSenderBankDebit(senderId: string, amount: number, transactionId: string) {
  if (FAILURE_STATE.sender_bank_failure) {
    throw new Error("sender-bank-service simulated failure (HTTP 503)");
  }
  if (FAILURE_STATE.timeout_simulation) {
    await sleep(5000);
  }
  await sleep(60);

  if (SENDER_DEBITS.has(transactionId)) {
    return { status: "DEBITED", approved: true, accountId: senderId };
  }

  const user = getUserByIdOrUpi(senderId);
  if (!user) {
    throw new Error(`Unknown sender account: ${senderId}`);
  }
  if (user.balance < amount) {
    return { status: "DECLINED", approved: false, reason: "Insufficient balance" };
  }

  user.balance = Math.max(0, user.balance - amount);
  SENDER_DEBITS.set(transactionId, { senderUpi: user.upi_id, amount });
  return { status: "DEBITED", approved: true, accountId: user.upi_id };
}

async function simulateSenderBankRollback(transactionId: string) {
  await sleep(40);
  const debit = SENDER_DEBITS.get(transactionId);
  if (!debit) {
    return { status: "NO_DEBIT_FOUND" };
  }
  SENDER_DEBITS.delete(transactionId);
  const user = getUserByIdOrUpi(debit.senderUpi);
  if (user) {
    user.balance += debit.amount;
  }
  return { status: "ROLLED_BACK", amount: debit.amount };
}

async function simulateNpciRoute(transactionId: string) {
  if (FAILURE_STATE.npci_failure) {
    throw new Error("npci-simulator-service simulated failure (HTTP 503)");
  }
  if (FAILURE_STATE.timeout_simulation) {
    await sleep(5000);
  }
  await sleep(120);
  return { status: "ROUTED", transactionId };
}

async function simulateReceiverBankCredit(receiverId: string, amount: number, transactionId: string) {
  if (FAILURE_STATE.receiver_bank_failure) {
    throw new Error("receiver-bank-service simulated failure (HTTP 503)");
  }
  if (FAILURE_STATE.timeout_simulation) {
    await sleep(5000);
  }
  await sleep(60);

  if (RECEIVER_CREDITS.has(transactionId)) {
    return { status: "CREDITED", ackId: RECEIVER_CREDITS.get(transactionId)! };
  }

  const user = getUserByIdOrUpi(receiverId);
  if (!user) {
    throw new Error(`Unknown receiver account: ${receiverId}`);
  }
  const ackId = randomUUID();
  user.balance += amount;
  RECEIVER_CREDITS.set(transactionId, ackId);
  return { status: "CREDITED", ackId };
}

class TransactionFailedError extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

async function callWithRetry<T>(
  operation: () => Promise<T>,
  transactionId: string,
  serviceLabel: string,
  txn: TransactionRecord
): Promise<T> {
  const breaker = getBreakerByLabel(serviceLabel);

  if (!(await breaker.canExecute())) {
    const reason = `Circuit breaker is ${breaker.state} for ${serviceLabel} - fast-failing request without network delay`;
    recordTimeline(txn, "CIRCUIT_BREAKER_FAST_FAIL", serviceLabel, reason);
    broadcastStreamEvent({
      event: "CIRCUIT_BREAKER_FAST_FAIL",
      transactionId,
      service: serviceLabel,
      circuitState: breaker.state,
      reason,
    });
    throw new TransactionFailedError(reason);
  }

  let lastError: Error | null = null;
  let wasTimeout = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), REQUEST_TIMEOUT_MS)
        ),
      ]);
      await breaker.recordSuccess();
      return result;
    } catch (err: any) {
      if (err?.message === "TIMEOUT") {
        wasTimeout = true;
        lastError = new Error(`${serviceLabel} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      await breaker.recordFailure();

      if (attempt === 0) {
        const msg = `Failure detected on ${serviceLabel}: ${wasTimeout ? "Timeout" : lastError.message}`;
        recordTimeline(txn, "SERVICE_FAILURE_DETECTED", serviceLabel, msg);
        broadcastStreamEvent({
          event: "SERVICE_FAILURE_DETECTED",
          transactionId,
          service: serviceLabel,
          reason: wasTimeout ? "Timeout" : lastError.message,
        });
      }

      if (attempt < MAX_RETRIES) {
        const nextAttempt = attempt + 1;
        recordTimeline(
          txn,
          `RETRY_ATTEMPT_${nextAttempt}`,
          serviceLabel,
          `Automated retry attempt ${nextAttempt}/${MAX_RETRIES} for ${serviceLabel}`
        );
        broadcastStreamEvent({
          event: `RETRY_ATTEMPT_${nextAttempt}`,
          transactionId,
          service: serviceLabel,
          attempt: nextAttempt,
        });
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  const finalReason = wasTimeout
    ? `${serviceLabel} timed out after ${MAX_RETRIES + 1} attempts`
    : `${serviceLabel} unavailable after ${MAX_RETRIES + 1} attempts (${lastError?.message})`;
  throw new TransactionFailedError(finalReason);
}

async function safeRollbackSenderDebit(txn: TransactionRecord, mode = "rest") {
  const txnId = txn.transactionId;
  recordTimeline(
    txn,
    "ROLLBACK_INITIATED",
    "Transaction Service",
    `Initiating compensating rollback of sender debit (mode=${mode.toUpperCase()})`
  );
  broadcastStreamEvent({
    event: "ROLLBACK_INITIATED",
    transactionId: txnId,
    service: "Transaction Service",
    message: `Initiating compensating rollback for sender debit (${mode.toUpperCase()})`,
  });

  try {
    await simulateSenderBankRollback(txnId);
    setStatus(txn, "ROLLBACK_COMPLETED");
    recordTimeline(
      txn,
      "ROLLBACK_COMPLETED",
      "Sender Bank Service",
      "Sender debit rolled back successfully to preserve consistency."
    );
    broadcastStreamEvent({
      event: "ROLLBACK_COMPLETED",
      transactionId: txnId,
      service: "Sender Bank Service",
      status: "ROLLBACK_COMPLETED",
      message: "Sender debit rolled back to preserve consistency",
    });
  } catch (err: any) {
    recordTimeline(
      txn,
      "ROLLBACK_FAILED",
      "Sender Bank Service",
      `Rollback attempt encountered error: ${err?.message || err}`
    );
    broadcastStreamEvent({
      event: "ROLLBACK_FAILED",
      transactionId: txnId,
      service: "Sender Bank Service",
      status: "ROLLBACK_FAILED",
      message: `Rollback attempt failed: ${err?.message || err}`,
    });
  }
}

async function failTransaction(txn: TransactionRecord, reason: string) {
  setStatus(txn, "FAILED", reason);
  recordTimeline(txn, "TRANSACTION_FAILED", "Transaction Service", `Transaction failed: ${reason}`);
  broadcastStreamEvent({
    event: "TRANSACTION_FAILED",
    transactionId: txn.transactionId,
    status: "FAILED",
    reason,
  });
}

async function processTransaction(txn: TransactionRecord): Promise<TransactionRecord> {
  const txnId = txn.transactionId;
  const mode = (txn.mode || "rest").toLowerCase();

  if (mode === "p2p" || mode === "peer") {
    const lP2p0 = lamportManager.tickLocal("transaction-service", "P2P Payment Request Created");
    const vP2p0 = vectorManager.tickLocal("transaction-service", "P2P Payment Request Created");
    setStatus(txn, "PROCESSING");
    recordTimeline(
      txn,
      "P2P_REQUEST_STARTED",
      "Transaction Service",
      "Direct Peer-to-Peer payment request initiated (bypassing NPCI switch)",
      { lamport: lP2p0, vector: vP2p0 }
    );
    broadcastStreamEvent({
      event: "P2P_REQUEST_STARTED",
      transactionId: txnId,
      status: "PROCESSING",
      mode: "p2p",
      npciUsed: false,
      sourcePeer: "sender-bank-service",
      destinationPeer: "receiver-bank-service",
      lamport: lP2p0,
      vector: vP2p0,
    });

    const lP2pConn = lamportManager.tickLocal("sender-bank", "Direct Peer Link Active");
    const vP2pConn = vectorManager.tickLocal("sender-bank", "Direct Peer Link Active");
    recordTimeline(
      txn,
      "P2P_PEER_CONNECTED",
      "Sender Bank Service",
      "Direct P2P connection established: sender-bank-service <-> receiver-bank-service",
      { lamport: lP2pConn, vector: vP2pConn }
    );
    broadcastStreamEvent({
      event: "P2P_PEER_CONNECTED",
      transactionId: txnId,
      mode: "p2p",
      npciUsed: false,
      sourcePeer: "sender-bank-service",
      destinationPeer: "receiver-bank-service",
      lamport: lP2pConn,
      vector: vP2pConn,
    });

    const lP2pSend = lamportManager.tickSend("sender-bank", "receiver-bank", `Direct P2P Credit Payload: ₹${txn.amount}`);
    const vP2pSend = vectorManager.tickSend("sender-bank", "receiver-bank", `Direct P2P Credit Payload: ₹${txn.amount}`);
    recordTimeline(
      txn,
      "P2P_PEER_REQUEST_SENT",
      "Sender Bank Service",
      "Direct P2P credit payload transmitted from Sender Bank directly to Receiver Bank (NPCI switch bypassed)",
      { lamport: lP2pSend, vector: vP2pSend }
    );
    broadcastStreamEvent({
      event: "P2P_PEER_REQUEST_SENT",
      transactionId: txnId,
      mode: "p2p",
      npciUsed: false,
      sourcePeer: "sender-bank-service",
      destinationPeer: "receiver-bank-service",
      lamport: lP2pSend,
      vector: vP2pSend,
    });

    try {
      const debitRes = await simulateSenderBankDebit(txn.senderId, txn.amount, txnId);
      if (!debitRes.approved) {
        await failTransaction(txn, debitRes.reason || "Sender bank declined debit");
        return txn;
      }
      const creditRes = await simulateReceiverBankCredit(txn.receiverId, txn.amount, txnId);
      const lP2pRecv = lamportManager.tickReceive("receiver-bank", "sender-bank", lP2pSend, "Direct Credit ACK Received");
      const vP2pRecv = vectorManager.tickReceive("receiver-bank", "sender-bank", vP2pSend, "Direct Credit ACK Received");

      recordTimeline(
        txn,
        "P2P_PEER_RESPONSE_RECEIVED",
        "Receiver Bank Service",
        "Direct ACK received from Receiver Bank (NPCI switch bypassed)",
        { lamport: lP2pRecv, vector: vP2pRecv }
      );
      broadcastStreamEvent({
        event: "P2P_PEER_RESPONSE_RECEIVED",
        transactionId: txnId,
        mode: "p2p",
        npciUsed: false,
        ackId: creditRes.ackId,
        sourcePeer: "sender-bank-service",
        destinationPeer: "receiver-bank-service",
        lamport: lP2pRecv,
        vector: vP2pRecv,
      });

      const lP2pFin = lamportManager.tickLocal("transaction-service", "P2P Direct Settlement Finalized");
      const vP2pFin = vectorManager.tickLocal("transaction-service", "P2P Direct Settlement Finalized");
      setStatus(txn, "SUCCESS");
      recordTimeline(
        txn,
        "P2P_TRANSACTION_COMPLETED",
        "Transaction Service",
        "P2P direct transaction successfully settled without NPCI switch",
        { lamport: lP2pFin, vector: vP2pFin }
      );
      recordTimeline(
        txn,
        "PAYMENT_SUCCESS",
        "Transaction Service",
        "P2P direct transaction successfully settled without NPCI switch",
        { lamport: lP2pFin, vector: vP2pFin }
      );
      broadcastStreamEvent({
        event: "P2P_TRANSACTION_COMPLETED",
        transactionId: txnId,
        status: "SUCCESS",
        mode: "p2p",
        npciUsed: false,
        lamport: lP2pFin,
        vector: vP2pFin,
      });
      broadcastStreamEvent({
        event: "PAYMENT_SUCCESS",
        transactionId: txnId,
        status: "SUCCESS",
        mode: "p2p",
        npciUsed: false,
        lamport: lP2pFin,
        vector: vP2pFin,
      });
      return txn;
    } catch (err: any) {
      await safeRollbackSenderDebit(txn, "p2p");
      await failTransaction(txn, err?.message || "P2P direct transfer failed");
      return txn;
    }
  }

  // Standard / gRPC / RabbitMQ flow
  const l0 = lamportManager.tickLocal("transaction-service", `Transaction ${txnId} Intent Created`);
  const v0 = vectorManager.tickLocal("transaction-service", `Transaction ${txnId} Intent Created`);

  setStatus(txn, "PROCESSING");
  recordTimeline(
    txn,
    "TRANSACTION_INITIATED",
    "Transaction Service",
    `Payment request received and validated (Protocol: ${mode.toUpperCase()})`,
    { lamport: l0, vector: v0 }
  );
  broadcastStreamEvent({
    event: "TRANSACTION_INITIATED",
    transactionId: txnId,
    status: "PROCESSING",
    mode,
    lamport: l0,
    vector: v0,
  });

  // Step 1: Sender Bank
  const lSendSnd = lamportManager.tickSend("transaction-service", "sender-bank", `Debit Request for ₹${txn.amount}`);
  const vSendSnd = vectorManager.tickSend("transaction-service", "sender-bank", `Debit Request for ₹${txn.amount}`);
  const lRecvSnd = lamportManager.tickReceive("sender-bank", "transaction-service", lSendSnd, "Debit Request received at Sender Bank");
  const vRecvSnd = vectorManager.tickReceive("sender-bank", "transaction-service", vSendSnd, "Debit Request received at Sender Bank");

  recordTimeline(
    txn,
    "SENDER_BANK_PROCESSING",
    "Sender Bank Service",
    `Validating sender account and checking available balance (${mode.toUpperCase()})`,
    { lamport: lRecvSnd, vector: vRecvSnd }
  );
  broadcastStreamEvent({
    event: "SENDER_BANK_PROCESSING",
    transactionId: txnId,
    service: "Sender Bank Service",
    mode,
    lamport: lRecvSnd,
    vector: vRecvSnd,
  });

  let debitResult: { status: string; approved: boolean; reason?: string };
  try {
    debitResult = await callWithRetry(
      () => simulateSenderBankDebit(txn.senderId, txn.amount, txnId),
      txnId,
      "Sender Bank Service",
      txn
    );
  } catch (err: any) {
    await failTransaction(txn, err.reason || err.message);
    return txn;
  }

  if (!debitResult.approved) {
    await failTransaction(txn, debitResult.reason || "Sender bank declined debit");
    return txn;
  }

  const lDebit = lamportManager.tickLocal("sender-bank", `Atomic debit ₹${txn.amount} on ${txn.senderId}`);
  const vDebit = vectorManager.tickLocal("sender-bank", `Atomic debit ₹${txn.amount} on ${txn.senderId}`);
  const lSndAck = lamportManager.tickSend("sender-bank", "transaction-service", "Debit Confirmed ACK");
  const vSndAck = vectorManager.tickSend("sender-bank", "transaction-service", "Debit Confirmed ACK");
  lamportManager.tickReceive("transaction-service", "sender-bank", lSndAck, "Debit Confirmed ACK Received");
  vectorManager.tickReceive("transaction-service", "sender-bank", vSndAck, "Debit Confirmed ACK Received");

  recordTimeline(
    txn,
    "SENDER_VERIFIED",
    "Sender Bank Service",
    `Sender account verified & debited successfully (${mode.toUpperCase()})`,
    { lamport: lDebit, vector: vDebit }
  );
  broadcastStreamEvent({
    event: "SENDER_VERIFIED",
    transactionId: txnId,
    service: "Sender Bank Service",
    mode,
    lamport: lDebit,
    vector: vDebit,
  });

  // Step 2: NPCI Routing
  const lSendNpci = lamportManager.tickSend("transaction-service", "npci", `Route request ${txnId}`);
  const vSendNpci = vectorManager.tickSend("transaction-service", "npci", `Route request ${txnId}`);
  const lRecvNpci = lamportManager.tickReceive("npci", "transaction-service", lSendNpci, "Route instruction received at NPCI");
  const vRecvNpci = vectorManager.tickReceive("npci", "transaction-service", vSendNpci, "Route instruction received at NPCI");

  recordTimeline(
    txn,
    "NPCI_PROCESSING",
    "NPCI Simulator Service",
    `Routing transaction across interbank switch (${mode.toUpperCase()})`,
    { lamport: lRecvNpci, vector: vRecvNpci }
  );
  broadcastStreamEvent({
    event: "NPCI_PROCESSING",
    transactionId: txnId,
    service: "NPCI Simulator Service",
    mode,
    lamport: lRecvNpci,
    vector: vRecvNpci,
  });

  try {
    await callWithRetry(
      () => simulateNpciRoute(txnId),
      txnId,
      "NPCI Simulator Service",
      txn
    );
  } catch (err: any) {
    await safeRollbackSenderDebit(txn, mode);
    await failTransaction(txn, err.reason || err.message);
    return txn;
  }

  const lNpciRoute = lamportManager.tickLocal("npci", "Interbank Route Cleared");
  const vNpciRoute = vectorManager.tickLocal("npci", "Interbank Route Cleared");

  recordTimeline(
    txn,
    "NPCI_ROUTED",
    "NPCI Simulator Service",
    `NPCI switch routed request to receiver bank (${mode.toUpperCase()})`,
    { lamport: lNpciRoute, vector: vNpciRoute }
  );
  broadcastStreamEvent({
    event: "NPCI_ROUTED",
    transactionId: txnId,
    service: "NPCI Simulator Service",
    mode,
    lamport: lNpciRoute,
    vector: vNpciRoute,
  });

  // Step 3: Receiver Bank Credit
  const lSendRcv = lamportManager.tickSend("npci", "receiver-bank", `Credit instruction for ₹${txn.amount}`);
  const vSendRcv = vectorManager.tickSend("npci", "receiver-bank", `Credit instruction for ₹${txn.amount}`);
  const lRecvRcv = lamportManager.tickReceive("receiver-bank", "npci", lSendRcv, "Credit instruction received");
  const vRecvRcv = vectorManager.tickReceive("receiver-bank", "npci", vSendRcv, "Credit instruction received");

  recordTimeline(
    txn,
    "RECEIVER_BANK_PROCESSING",
    "Receiver Bank Service",
    `Processing credit to beneficiary account (${mode.toUpperCase()})`,
    { lamport: lRecvRcv, vector: vRecvRcv }
  );
  broadcastStreamEvent({
    event: "RECEIVER_BANK_PROCESSING",
    transactionId: txnId,
    service: "Receiver Bank Service",
    mode,
    lamport: lRecvRcv,
    vector: vRecvRcv,
  });

  try {
    await callWithRetry(
      () => simulateReceiverBankCredit(txn.receiverId, txn.amount, txnId),
      txnId,
      "Receiver Bank Service",
      txn
    );
  } catch (err: any) {
    await safeRollbackSenderDebit(txn, mode);
    await failTransaction(txn, err.reason || err.message);
    return txn;
  }

  // Step 4: Final Success
  const lCredit = lamportManager.tickLocal("receiver-bank", `Beneficiary account ${txn.receiverId} credited`);
  const vCredit = vectorManager.tickLocal("receiver-bank", `Beneficiary account ${txn.receiverId} credited`);
  const lRcvAck = lamportManager.tickSend("receiver-bank", "transaction-service", "Credit Confirmed ACK");
  const vRcvAck = vectorManager.tickSend("receiver-bank", "transaction-service", "Credit Confirmed ACK");
  const lFinal = lamportManager.tickReceive("transaction-service", "receiver-bank", lRcvAck, "Settlement Finalized");
  const vFinal = vectorManager.tickReceive("transaction-service", "receiver-bank", vRcvAck, "Settlement Finalized");

  setStatus(txn, "SUCCESS");
  recordTimeline(
    txn,
    "PAYMENT_SUCCESS",
    "Transaction Service",
    `Transaction successfully completed and settled (${mode.toUpperCase()})`,
    { lamport: lFinal, vector: vFinal }
  );
  broadcastStreamEvent({
    event: "PAYMENT_SUCCESS",
    transactionId: txnId,
    status: "SUCCESS",
    mode,
    lamport: lFinal,
    vector: vFinal,
  });

  return txn;
}

function getStats() {
  const all = Array.from(TRANSACTIONS.values());
  const total = all.length;
  const successful = all.filter((t) => t.status === "SUCCESS").length;
  const failed = all.filter((t) => t.status === "FAILED" || t.status === "ROLLBACK_COMPLETED").length;
  const processing = Math.max(0, total - (successful + failed));
  return { total, successful, failed, processing };
}

// ---------------------------------------------------------------------------
// Express App & HTTP/WebSocket Server Setup
// ---------------------------------------------------------------------------

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Start Beacon Failure Detector
  const isNodeFailed = (nodeId: string): boolean => {
    if (nodeId === "sender-bank") return FAILURE_STATE.sender_bank_failure;
    if (nodeId === "npci") return FAILURE_STATE.npci_failure;
    if (nodeId === "receiver-bank") return FAILURE_STATE.receiver_bank_failure;
    return false;
  };

  beaconManager.start(isNodeFailed, (beacons) => {
    broadcastStreamEvent({
      event: "BEACONS_UPDATED",
      service: "Beacon Protocol Manager",
      message: "Node beacon heartbeat state changed",
      beacons,
    });
  });

  // Health Checks
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      service: "transaction-service",
      status: "healthy",
      port: 8000,
      timestamp: nowIso(),
    });
  });

  app.get("/services/sender-bank/health", (_req: Request, res: Response) => {
    res.json({
      service: "sender-bank-service",
      status: "healthy",
      port: 8001,
      timestamp: nowIso(),
    });
  });

  app.get("/services/npci/health", (_req: Request, res: Response) => {
    res.json({
      service: "npci-simulator-service",
      status: "healthy",
      port: 8002,
      timestamp: nowIso(),
    });
  });

  app.get("/services/receiver-bank/health", (_req: Request, res: Response) => {
    res.json({
      service: "receiver-bank-service",
      status: "healthy",
      port: 8003,
      timestamp: nowIso(),
    });
  });

  // Users & Stats
  app.get("/api/users", (_req: Request, res: Response) => {
    res.json({ users: listUsers() });
  });

  app.get("/api/stats", (_req: Request, res: Response) => {
    res.json(getStats());
  });

  // High-performance atomic snapshot endpoint (replaces 7 separate HTTP calls with 1)
  app.get("/api/snapshot", (_req: Request, res: Response) => {
    const txns = Array.from(TRANSACTIONS.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    res.json({
      health: {
        "transaction-service": { service: "Transaction Service", port: "8000", status: "healthy" },
        "sender-bank": {
          service: "Sender Bank Service",
          port: "8001",
          status: FAILURE_STATE.sender_bank_failure ? "unhealthy" : "healthy",
        },
        npci: {
          service: "NPCI Simulator",
          port: "8002",
          status: FAILURE_STATE.npci_failure ? "unhealthy" : "healthy",
        },
        "receiver-bank": {
          service: "Receiver Bank Service",
          port: "8003",
          status: FAILURE_STATE.receiver_bank_failure ? "unhealthy" : "healthy",
        },
      },
      stats: getStats(),
      users: listUsers(),
      failureState: {
        ...FAILURE_STATE,
        circuit_breakers: getAllCircuitBreakerStatuses(),
      },
      synchronization: {
        clocks: clockSyncManager.getClocks(),
        lamport: lamportManager.getAllClocks(),
        vectors: vectorManager.getAllVectors(),
        beacons: beaconManager.getBeacons(),
        latestSnapshot: globalStateManager.getSnapshots()[0] || null,
      },
      transactions: txns,
      wsStats: getStreamStats(),
    });
  });

  app.post("/failure/reset-all", async (_req: Request, res: Response) => {
    FAILURE_STATE.sender_bank_failure = false;
    FAILURE_STATE.npci_failure = false;
    FAILURE_STATE.receiver_bank_failure = false;
    FAILURE_STATE.timeout_simulation = false;
    for (const cb of Object.values(circuitBreakers)) {
      await cb.reset();
    }
    const payload = {
      ...FAILURE_STATE,
      circuit_breakers: getAllCircuitBreakerStatuses(),
    };
    broadcastStreamEvent({
      event: "SYSTEM_RESTORED",
      service: "Chaos Controller",
      message: "All bank nodes, NPCI switch, and circuit breakers restored to nominal state",
    });
    res.json(payload);
  });

  // Transactions
  app.post("/api/transaction/initiate", async (req: Request, res: Response) => {
    try {
      const { senderId, receiverId, amount, idempotencyKey, mode } = req.body || {};
      const numAmount = Number(amount);

      if (!senderId || !receiverId) {
        res.status(400).json({ detail: "senderId and receiverId are required" });
        return;
      }
      if (senderId === receiverId) {
        res.status(400).json({ detail: "Sender and receiver must be different accounts" });
        return;
      }
      if (isNaN(numAmount) || numAmount <= 0) {
        res.status(400).json({ detail: "Amount must be greater than zero" });
        return;
      }

      const senderUser = getUserByIdOrUpi(String(senderId));
      const receiverUser = getUserByIdOrUpi(String(receiverId));

      if (senderUser && receiverUser && senderUser.upi_id === receiverUser.upi_id) {
        res.status(400).json({ detail: "Sender and receiver must be different accounts" });
        return;
      }

      const senderUpi = senderUser ? senderUser.upi_id : String(senderId);
      const receiverUpi = receiverUser ? receiverUser.upi_id : String(receiverId);
      const idemKey = idempotencyKey || `auto-${randomUUID().replace(/-/g, "")}`;

      const existingTxnId = IDEMPOTENCY_INDEX.get(idemKey);
      if (existingTxnId && TRANSACTIONS.has(existingTxnId)) {
        const existingTxn = TRANSACTIONS.get(existingTxnId)!;
        broadcastStreamEvent({
          event: "DUPLICATE_REQUEST_DETECTED",
          transactionId: existingTxn.transactionId,
          idempotencyKey: idemKey,
          status: existingTxn.status,
        });
        res.json({
          ...existingTxn,
          duplicateRequest: true,
          message: "Existing transaction returned. Duplicate processing prevented.",
        });
        return;
      }

      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const txnId = `TXN-${datePart}-${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      const now = nowIso();

      const txn: TransactionRecord = {
        transactionId: txnId,
        senderId: senderUpi,
        receiverId: receiverUpi,
        amount: numAmount,
        status: "INITIATED",
        failureReason: null,
        idempotencyKey: idemKey,
        mode: mode ? String(mode).toLowerCase() : "rest",
        timeline: [],
        createdAt: now,
        updatedAt: now,
      };

      TRANSACTIONS.set(txnId, txn);
      IDEMPOTENCY_INDEX.set(idemKey, txnId);

      const processed = await processTransaction(txn);
      res.json({ ...processed, duplicateRequest: false });
    } catch (err: any) {
      res.status(500).json({ detail: err?.message || "Internal server error" });
    }
  });

  app.get("/api/transaction/:transactionId/status", (req: Request, res: Response) => {
    const txn = TRANSACTIONS.get(String(req.params.transactionId));
    if (!txn) {
      res.status(404).json({ detail: "Transaction not found" });
      return;
    }
    res.json(txn);
  });

  app.get("/api/transactions", (req: Request, res: Response) => {
    const statusFilter = req.query.status ? String(req.query.status).toUpperCase() : null;
    let list = Array.from(TRANSACTIONS.values());
    if (statusFilter && statusFilter !== "ALL") {
      list = list.filter((t) => t.status === statusFilter);
    }
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ transactions: list });
  });

  // WebSocket & WebRTC Stats
  app.get("/api/websocket/stats", (_req: Request, res: Response) => {
    res.json(getStreamStats());
  });

  app.get("/api/webrtc/rooms", (_req: Request, res: Response) => {
    res.json({ rooms: getAllWebRTCRooms() });
  });

  // Fault Tolerance Simulation Controls
  app.post("/failure/timeout/enable", (_req: Request, res: Response) => {
    FAILURE_STATE.timeout_simulation = true;
    beaconManager.tickBeacons(isNodeFailed);
    res.json({ ...FAILURE_STATE, circuit_breakers: getAllCircuitBreakerStatuses() });
  });

  app.post("/failure/timeout/disable", (_req: Request, res: Response) => {
    FAILURE_STATE.timeout_simulation = false;
    beaconManager.tickBeacons(isNodeFailed);
    res.json({ ...FAILURE_STATE, circuit_breakers: getAllCircuitBreakerStatuses() });
  });

  app.post("/failure/:target/enable", (req: Request, res: Response) => {
    const target = String(req.params.target);
    const key = FRIENDLY_TO_TARGET[target];
    if (!key) {
      res.status(404).json({ detail: `Unknown failure target: ${target}` });
      return;
    }
    FAILURE_STATE[key] = true;
    beaconManager.tickBeacons(isNodeFailed);
    res.json({ ...FAILURE_STATE, circuit_breakers: getAllCircuitBreakerStatuses() });
  });

  app.post("/failure/:target/disable", (req: Request, res: Response) => {
    const target = String(req.params.target);
    const key = FRIENDLY_TO_TARGET[target];
    if (!key) {
      res.status(404).json({ detail: `Unknown failure target: ${target}` });
      return;
    }
    FAILURE_STATE[key] = false;
    beaconManager.tickBeacons(isNodeFailed);
    res.json({ ...FAILURE_STATE, circuit_breakers: getAllCircuitBreakerStatuses() });
  });

  app.get("/failure/status", (_req: Request, res: Response) => {
    res.json({
      ...FAILURE_STATE,
      circuit_breakers: getAllCircuitBreakerStatuses(),
    });
  });

  app.get("/api/circuit-breaker/status", (_req: Request, res: Response) => {
    res.json({ circuitBreakers: getAllCircuitBreakerStatuses() });
  });

  app.post("/api/circuit-breaker/reset", async (_req: Request, res: Response) => {
    for (const cb of Object.values(circuitBreakers)) {
      await cb.reset();
    }
    res.json({ status: "RESET", circuitBreakers: getAllCircuitBreakerStatuses() });
  });

  app.get("/api/dashboard/stats", (_req: Request, res: Response) => {
    const protocols = [
      {
        id: "rest",
        name: "REST / HTTP/1.1",
        phase: "Phase 0 & 1",
        type: "Synchronous Request-Response",
        transport: "HTTP/1.1 JSON over TCP",
        routing: "Central Hub Orchestrator",
        npciBypassed: false,
        status: "Active",
        description: "Standard UPI central hub flow with 3-state Circuit Breaker & retries.",
      },
      {
        id: "grpc",
        name: "gRPC / HTTP/2",
        phase: "Phase 2",
        type: "Synchronous Binary RPC",
        transport: "HTTP/2 Protocol Buffers (upi.proto)",
        routing: "Central Hub Orchestrator",
        npciBypassed: false,
        status: "Active",
        description: "High-efficiency strongly-typed binary remote procedure calls.",
      },
      {
        id: "rabbitmq",
        name: "RabbitMQ AMQP",
        phase: "Phase 3",
        type: "Asynchronous Message-Oriented Broker",
        transport: "AMQP 0-9-1 Topic Exchange & DLX",
        routing: "Queue Consumers (q.sender.debit, q.npci, etc.)",
        npciBypassed: false,
        status: "Active",
        description: "Decoupled queue worker processing with Dead Letter Exchange resilience.",
      },
      {
        id: "websocket",
        name: "WebSocket Push",
        phase: "Phase 4",
        type: "Stream-Oriented Real-Time Push",
        transport: "Persistent WebSocket TCP Stream",
        routing: "Broadcast Stream Manager (Ring Buffer: 500)",
        npciBypassed: false,
        status: "Active",
        description: "Low-latency event streaming with sequence numbering & recovery replay.",
      },
      {
        id: "p2p",
        name: "Direct P2P HTTP",
        phase: "Phase 5",
        type: "Direct Peer Messaging",
        transport: "HTTP REST (Sender Bank -> Receiver Bank)",
        routing: "Direct Inter-Bank Connection",
        npciBypassed: true,
        status: "Active",
        description: "Direct bank-to-bank credit transfer completely bypassing NPCI Switch.",
      },
      {
        id: "webrtc",
        name: "WebRTC RTCDataChannel",
        phase: "Phase 6",
        type: "Browser Peer-to-Peer DataChannel",
        transport: "SCTP over DTLS/UDP (STUN Traversal)",
        routing: "Direct Browser-to-Browser (Backend Signaling Only)",
        npciBypassed: true,
        status: "Active",
        description: "Browser-to-browser P2P DataChannel payload exchange with zero backend data routing.",
      },
    ];

    res.json({
      timestamp: nowIso(),
      transactionStats: getStats(),
      circuitBreakers: getAllCircuitBreakerStatuses(),
      websocketStream: getStreamStats(),
      webrtcRooms: getAllWebRTCRooms(),
      failureState: FAILURE_STATE,
      protocols,
    });
  });

  // =========================================================================
  // UNIT III: SYNCHRONIZATION & UNIT IV: DISTRIBUTED WEB-BASED SYSTEMS APIS
  // =========================================================================

  // 1. Clock Synchronization
  app.get("/api/synchronization/clocks", (_req: Request, res: Response) => {
    res.json({
      clocks: clockSyncManager.getClocks(),
      explanation: "Simulated physical clocks demonstrating clock drift, offsets, and Berkeley consensus convergence across the 4 distributed nodes.",
    });
  });

  app.post("/api/synchronization/clocks/sync", (_req: Request, res: Response) => {
    const result = clockSyncManager.synchronize();
    broadcastStreamEvent({
      event: "CLOCKS_SYNCHRONIZED",
      service: "Clock Sync Coordinator",
      message: "Physical clocks converged to consensus time cut",
      consensusOffsetMs: result.consensusOffsetMs,
    });
    res.json(result);
  });

  app.post("/api/synchronization/clocks/drift", (req: Request, res: Response) => {
    const { nodeId, driftMs } = req.body || {};
    const targetNode = nodeId || "sender-bank";
    const delta = Number(driftMs) || 1500;
    const updated = clockSyncManager.introduceDrift(targetNode, delta);
    broadcastStreamEvent({
      event: "CLOCK_DRIFT_INTRODUCED",
      service: targetNode,
      message: `Simulated clock drift of ${delta}ms introduced on ${targetNode}`,
    });
    res.json({ clocks: updated });
  });

  app.post("/api/synchronization/clocks/reset", (_req: Request, res: Response) => {
    clockSyncManager.resetClocks();
    res.json({ clocks: clockSyncManager.getClocks() });
  });

  // 2. Lamport's Logical Clock Algorithm
  app.get("/api/synchronization/lamport", (_req: Request, res: Response) => {
    res.json({
      clocks: lamportManager.getAllClocks(),
      history: lamportManager.getHistory(30),
      rules: {
        local: "L_i = L_i + 1",
        send: "L_i = L_i + 1 (attached to outgoing message)",
        receive: "L_j = max(L_j, T_msg) + 1",
      },
    });
  });

  app.post("/api/synchronization/lamport/event", (req: Request, res: Response) => {
    const { type, fromNode, toNode, description, incomingTimestamp } = req.body || {};
    let clockValue: number;

    if (type === "SEND") {
      const from = fromNode || "transaction-service";
      const to = toNode || "sender-bank";
      clockValue = lamportManager.tickSend(from, to, description || "Manual Send Request");
    } else if (type === "RECEIVE") {
      const to = toNode || "sender-bank";
      const from = fromNode || "transaction-service";
      const t = Number(incomingTimestamp) || lamportManager.getClock(from);
      clockValue = lamportManager.tickReceive(to, from, t, description || "Manual Receive Request");
    } else {
      const node = fromNode || "transaction-service";
      clockValue = lamportManager.tickLocal(node, description || "Manual Local Event");
    }

    broadcastStreamEvent({
      event: "LAMPORT_CLOCK_TICK",
      service: fromNode || "transaction-service",
      eventType: type || "LOCAL",
      clock: clockValue,
      description: description || "Lamport event processed",
    });

    res.json({
      clock: clockValue,
      clocks: lamportManager.getAllClocks(),
      history: lamportManager.getHistory(30),
    });
  });

  app.post("/api/synchronization/lamport/reset", (_req: Request, res: Response) => {
    lamportManager.reset();
    res.json({ clocks: lamportManager.getAllClocks(), history: [] });
  });

  // 3. Vector Clock Algorithm
  app.get("/api/synchronization/vector", (_req: Request, res: Response) => {
    res.json({
      vectors: vectorManager.getAllVectors(),
      history: vectorManager.getHistory(30),
      nodeMapping: "[0: Sender Bank, 1: Transaction Service, 2: NPCI, 3: Receiver Bank]",
    });
  });

  app.post("/api/synchronization/vector/event", (req: Request, res: Response) => {
    const { type, fromNode, toNode, description, incomingVector } = req.body || {};
    let vectorValue: VectorClock;

    if (type === "SEND") {
      const from = fromNode || "transaction-service";
      const to = toNode || "sender-bank";
      vectorValue = vectorManager.tickSend(from, to, description || "Manual Send");
    } else if (type === "RECEIVE") {
      const to = toNode || "sender-bank";
      const from = fromNode || "transaction-service";
      const w: VectorClock = Array.isArray(incomingVector) && incomingVector.length === 4
        ? (incomingVector as VectorClock)
        : vectorManager.getVector(from);
      vectorValue = vectorManager.tickReceive(to, from, w, description || "Manual Receive");
    } else {
      const node = fromNode || "transaction-service";
      vectorValue = vectorManager.tickLocal(node, description || "Manual Local Event");
    }

    broadcastStreamEvent({
      event: "VECTOR_CLOCK_TICK",
      service: fromNode || "transaction-service",
      eventType: type || "LOCAL",
      vector: vectorValue,
      description: description || "Vector event processed",
    });

    res.json({
      vector: vectorValue,
      vectors: vectorManager.getAllVectors(),
      history: vectorManager.getHistory(30),
    });
  });

  app.post("/api/synchronization/vector/compare", (req: Request, res: Response) => {
    const { vectorA, vectorB } = req.body || {};
    if (!Array.isArray(vectorA) || !Array.isArray(vectorB) || vectorA.length !== 4 || vectorB.length !== 4) {
      res.status(400).json({ detail: "vectorA and vectorB must both be 4-element integer arrays [Sender, Transaction, NPCI, Receiver]" });
      return;
    }
    const result = VectorClockManager.compare(vectorA as VectorClock, vectorB as VectorClock);
    res.json(result);
  });

  app.post("/api/synchronization/vector/reset", (_req: Request, res: Response) => {
    vectorManager.reset();
    res.json({ vectors: vectorManager.getAllVectors(), history: [] });
  });

  // 4. Global State Snapshot (Chandy-Lamport Simulator)
  app.get("/api/synchronization/global-state", (_req: Request, res: Response) => {
    res.json({
      snapshots: globalStateManager.getSnapshots(),
    });
  });

  app.post("/api/synchronization/global-state/capture", (_req: Request, res: Response) => {
    const activeTxn = Array.from(TRANSACTIONS.values()).find((t) => t.status === "PROCESSING" || t.status === "INITIATED")
      || Array.from(TRANSACTIONS.values()).slice(-1)[0]
      || null;

    const lamport = lamportManager.getClock("transaction-service");
    const vector = vectorManager.getVector("transaction-service");
    const snap = globalStateManager.captureSnapshot(
      lamport,
      vector,
      activeTxn,
      listUsers(),
      FAILURE_STATE
    );

    broadcastStreamEvent({
      event: "GLOBAL_STATE_CAPTURED",
      service: "Chandy-Lamport Coordinator",
      message: `Global snapshot ${snap.snapshotId} captured across distributed nodes and channels`,
      snapshotId: snap.snapshotId,
    });

    res.json(snap);
  });

  // 5. Beacon Protocol (Heartbeat-Based Failure Detection)
  app.get("/api/synchronization/beacons", (_req: Request, res: Response) => {
    res.json({
      beacons: beaconManager.getBeacons(),
      intervalMs: 2000,
      timeoutThresholdMs: 5000,
      integration: "Integrated with Chaos/Fault toggles (tripping a node suppresses its beacons)",
    });
  });

  app.post("/api/synchronization/beacons/pulse", (req: Request, res: Response) => {
    const { nodeId } = req.body || {};
    const b = beaconManager.recordManualBeacon(nodeId || "sender-bank");
    res.json({ beacon: b, beacons: beaconManager.getBeacons() });
  });

  // 6. UNIT IV: Distributed Web-Based Systems Architectural Metadata
  app.get("/api/synchronization/architecture", (_req: Request, res: Response) => {
    res.json({
      topic: "UNIT IV — Distributed Web-Based Systems",
      systemType: "Multi-Tier Web-Based Distributed Payment Orchestrator",
      tiers: [
        {
          tier: "Client Tier (Web Browser / Presentation)",
          components: ["React 18 Single Page Application (SPA)", "Vite 6 Fast Bundler", "WebSocket Real-Time Client", "WebRTC SCTP Peer"],
          protocols: ["HTTP/1.1", "HTTP/2", "WebSocket (WSS)", "WebRTC P2P DataChannel"],
          responsibility: "User interface, VPA selection, idempotency key generation, real-time telemetry rendering, educational visualization",
        },
        {
          tier: "Web & API Gateway Tier",
          components: ["Express.js HTTP Gateway (Port :8000 / :3000)", "Reverse Proxy & Middleware Router", "REST Endpoints (/api/*)", "WebSocket Broadcast Hub (/ws/transactions)"],
          protocols: ["REST over HTTP", "JSON Payload encoding", "CORS policy enforcement", "Multiplexed WebSocket"],
          responsibility: "Request authentication, idempotency check, route multiplexing, client event streaming",
        },
        {
          tier: "Distributed Business Logic & Orchestration Tier",
          components: ["Transaction Service Coordinator", "3-State Circuit Breaker", "Exponential Backoff Retry Engine", "Compensating Saga Rollback Coordinator"],
          protocols: ["Synchronous REST (HTTP/1.1)", "gRPC / Protobuf (HTTP/2)", "RabbitMQ AMQP 0-9-1 Topic Exchange", "Direct P2P HTTP Wire"],
          responsibility: "Coordinates multi-party transaction commits, handles node failures, manages Lamport and Vector clocks",
        },
        {
          tier: "Distributed Service Endpoints Tier",
          components: ["Sender Bank Service (:8001)", "NPCI Interbank Switch Simulator (:8002)", "Receiver Bank Service (:8003)"],
          protocols: ["Independent HTTP microservice ports", "Simulated gRPC proto services", "RabbitMQ durable queue consumers"],
          responsibility: "Account balance verification, atomic debit, interbank routing, beneficiary credit settlement",
        },
      ],
      communicationFlow: [
        "1. Web Client issues HTTP POST /api/transaction/initiate with { senderId, receiverId, amount, idempotencyKey, mode }",
        "2. Transaction Service validates idempotency index, registers transaction state cut, initializes Lamport & Vector timestamps",
        "3. Transaction Service dispatches debit request to Sender Bank Service (REST / gRPC / AMQP / P2P)",
        "4. Sender Bank performs atomic debit and responds with ACK or error",
        "5. Transaction Service dispatches routing request across NPCI Simulator switch",
        "6. NPCI clears route and forwards credit instruction to Receiver Bank Service",
        "7. Receiver Bank executes credit ledger update and returns signed confirmation",
        "8. Transaction Service marks transaction SUCCESS and broadcasts event frame over WebSocket to connected Web Clients",
        "9. On failure at any step, compensating Saga rollback is dispatched to Sender Bank to refund debited amount and maintain consistency",
      ],
      academicDisclaimers: "This project is an educational simulator demonstrating distributed-system concepts using a UPI-inspired workflow. It does not implement actual NPCI or banking production infrastructure.",
    });
  });

  // Vite middleware in dev or static assets in prod
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const httpServer = createServer(app);

  // WebSocket multiplexing on port 3000
  const wssTransactions = new WebSocketServer({ noServer: true });
  const wssWebRTC = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const reqUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (reqUrl.pathname === "/ws/transactions") {
      wssTransactions.handleUpgrade(request, socket, head, (ws) => {
        wssTransactions.emit("connection", ws, request, reqUrl);
      });
    } else if (reqUrl.pathname === "/ws/webrtc") {
      wssWebRTC.handleUpgrade(request, socket, head, (ws) => {
        wssWebRTC.emit("connection", ws, request, reqUrl);
      });
    } else {
      socket.destroy();
    }
  });

  wssTransactions.on("connection", (ws: WebSocket, _req: any, reqUrl: URL) => {
    streamClients.add(ws);
    const lastSeqParam = Number(reqUrl.searchParams.get("lastSequence") || 0);
    if (lastSeqParam > 0) {
      replayMissedEvents(ws, lastSeqParam);
    }

    ws.on("message", (raw) => {
      const str = raw.toString();
      if (!str) return;
      let data: Record<string, any>;
      try {
        data = JSON.parse(str);
        if (typeof data !== "object" || data === null) {
          data = { action: String(data) };
        }
      } catch {
        data = { action: str.trim() };
      }

      const action = String(data.action || data.type || data.event || "").toLowerCase();
      if (action === "ping" || action === "heartbeat") {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              event: "PONG",
              eventType: "PONG",
              timestamp: nowIso(),
              sequence: sequenceCounter,
            })
          );
        }
      } else if (action === "replay") {
        const reqSeq = Number(data.lastSequence || 0);
        replayMissedEvents(ws, reqSeq);
      } else if (action === "stats") {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: "STREAM_STATS", ...getStreamStats() }));
        }
      }
    });

    ws.on("close", () => {
      streamClients.delete(ws);
    });

    ws.on("error", () => {
      streamClients.delete(ws);
    });
  });

  wssWebRTC.on("connection", (ws: WebSocket, _req: any, reqUrl: URL) => {
    let currentRoom = reqUrl.searchParams.get("roomId") || "";
    let currentPeer = reqUrl.searchParams.get("peerId") || "";

    if (currentRoom && currentPeer) {
      const joined = connectWebRTCPeer(ws, currentRoom, currentPeer);
      if (!joined) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `PeerId '${currentPeer}' already taken in room '${currentRoom}'`,
          })
        );
        ws.close();
        return;
      }
      const peers = getWebRTCRoomPeers(currentRoom);
      ws.send(JSON.stringify({ type: "joined", roomId: currentRoom, peerId: currentPeer, peers }));
      routeWebRTCSignalingMessage(ws, {
        type: "peer-joined",
        roomId: currentRoom,
        peerId: currentPeer,
        peers,
      });
      broadcastStreamEvent({
        event: "WEBRTC_PEER_JOINED",
        roomId: currentRoom,
        peerId: currentPeer,
        mode: "webrtc",
        npciUsed: false,
      });
    }

    ws.on("message", (raw) => {
      const str = raw.toString();
      if (!str) return;
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(str);
        if (typeof msg !== "object" || msg === null) {
          ws.send(JSON.stringify({ type: "error", message: "Signaling message must be a JSON object" }));
          return;
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON signaling message" }));
        return;
      }

      const msgType = String(msg.type || msg.action || "").toLowerCase();
      if (msgType === "join") {
        const rId = msg.roomId || currentRoom;
        const pId = msg.peerId || currentPeer;
        if (!rId || !pId) {
          ws.send(JSON.stringify({ type: "error", message: "roomId and peerId are required for join" }));
          return;
        }
        currentRoom = rId;
        currentPeer = pId;
        const joined = connectWebRTCPeer(ws, currentRoom, currentPeer);
        if (!joined) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: `PeerId '${currentPeer}' already taken in room '${currentRoom}'`,
            })
          );
          return;
        }
        const peers = getWebRTCRoomPeers(currentRoom);
        ws.send(JSON.stringify({ type: "joined", roomId: currentRoom, peerId: currentPeer, peers }));
        routeWebRTCSignalingMessage(ws, {
          type: "peer-joined",
          roomId: currentRoom,
          peerId: currentPeer,
          peers,
        });
        broadcastStreamEvent({
          event: "WEBRTC_PEER_JOINED",
          roomId: currentRoom,
          peerId: currentPeer,
          mode: "webrtc",
          npciUsed: false,
        });
      } else if (msgType === "leave") {
        disconnectWebRTCSocket(ws);
        ws.send(JSON.stringify({ type: "left", roomId: currentRoom, peerId: currentPeer }));
        broadcastStreamEvent({
          event: "WEBRTC_PEER_DISCONNECTED",
          roomId: currentRoom,
          peerId: currentPeer,
          mode: "webrtc",
          npciUsed: false,
        });
      } else if (["offer", "answer", "ice-candidate", "candidate"].includes(msgType)) {
        routeWebRTCSignalingMessage(ws, msg);
        const evtName =
          msgType === "offer"
            ? "WEBRTC_OFFER_CREATED"
            : msgType === "answer"
            ? "WEBRTC_ANSWER_CREATED"
            : "WEBRTC_ICE_CANDIDATE";
        broadcastStreamEvent({
          event: evtName,
          roomId: currentRoom,
          peerId: currentPeer,
          mode: "webrtc",
          npciUsed: false,
        });
      } else if (msgType === "ping" || msgType === "heartbeat") {
        ws.send(JSON.stringify({ type: "pong", timestamp: nowIso() }));
      } else {
        routeWebRTCSignalingMessage(ws, msg);
      }
    });

    ws.on("close", () => {
      const res = disconnectWebRTCSocket(ws);
      if (res) {
        broadcastStreamEvent({
          event: "WEBRTC_PEER_DISCONNECTED",
          roomId: res.roomId,
          peerId: res.peerId,
          mode: "webrtc",
          npciUsed: false,
        });
      }
    });

    ws.on("error", () => {
      disconnectWebRTCSocket(ws);
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`UPI Distributed Transaction Simulator running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
