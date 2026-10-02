// ============================================================================
// UNIT III — Synchronization & UNIT IV — Distributed Web-Based Systems
// Core Educational Distributed Systems Algorithms for UPI Simulator
// ============================================================================

export interface SimulatedClockNode {
  id: string;
  name: string;
  port: number;
  baseOffsetMs: number;       // Inherent skew/drift in ms relative to reference
  adjustedOffsetMs: number;   // Offset adjustment computed during clock sync
  lastSyncTimestamp: number | null;
  status: "SYNCHRONIZED" | "DRIFTING" | "DESYNCHRONIZED";
}

export interface LamportNodeState {
  id: string;
  name: string;
  clock: number;
  lastEvent: string;
  lastTimestamp: string;
}

export type VectorClock = [number, number, number, number];
// Index mapping:
// 0: Sender Bank
// 1: Transaction Service
// 2: NPCI
// 3: Receiver Bank
export const NODE_INDICES: Record<string, number> = {
  "sender-bank": 0,
  "transaction-service": 1,
  "npci": 2,
  "receiver-bank": 3,
};

export const INDEX_NODES: string[] = [
  "sender-bank",
  "transaction-service",
  "npci",
  "receiver-bank",
];

export interface VectorNodeState {
  id: string;
  name: string;
  vector: VectorClock;
  lastEvent: string;
  lastTimestamp: string;
}

export interface BeaconState {
  id: string;
  name: string;
  port: number;
  lastBeaconTime: string;
  lastBeaconEpochMs: number;
  beaconIntervalMs: number;
  timeoutThresholdMs: number;
  sequence: number;
  status: "HEALTHY" | "SUSPECTED" | "UNREACHABLE" | "RECOVERED";
  consecutiveMisses: number;
}

export interface GlobalSnapshot {
  snapshotId: string;
  timestamp: string;
  lamportTime: number;
  vectorTime: VectorClock;
  activeTransactionId: string | null;
  nodeStates: {
    senderBank: { state: string; balance: number; lastAction: string };
    transactionService: { state: string; activeTxns: number; lastAction: string };
    npci: { state: string; routingQueue: number; lastAction: string };
    receiverBank: { state: string; creditsRecorded: number; lastAction: string };
  };
  channelStates: {
    clientToHub: { inFlight: boolean; message: string | null };
    hubToSender: { inFlight: boolean; message: string | null };
    senderToHub: { inFlight: boolean; message: string | null };
    hubToNpci: { inFlight: boolean; message: string | null };
    npciToReceiver: { inFlight: boolean; message: string | null };
    receiverToHub: { inFlight: boolean; message: string | null };
    directP2P: { inFlight: boolean; message: string | null };
  };
  consistent: boolean;
  notes: string;
}

// ----------------------------------------------------------------------------
// 1. Clock Synchronization Implementation (Cristian / Berkeley Consensus)
// ----------------------------------------------------------------------------

export class ClockSyncManager {
  private nodes: Map<string, SimulatedClockNode> = new Map();

  constructor() {
    this.resetClocks();
  }

  resetClocks() {
    this.nodes.clear();
    // Deliberate initial skews typical of un-synchronized distributed nodes
    this.nodes.set("sender-bank", {
      id: "sender-bank",
      name: "Sender Bank Service",
      port: 8001,
      baseOffsetMs: -2150, // -2.15 seconds slow
      adjustedOffsetMs: 0,
      lastSyncTimestamp: null,
      status: "DESYNCHRONIZED",
    });
    this.nodes.set("transaction-service", {
      id: "transaction-service",
      name: "Transaction Service (Coordinator)",
      port: 8000,
      baseOffsetMs: 0, // reference clock
      adjustedOffsetMs: 0,
      lastSyncTimestamp: null,
      status: "DESYNCHRONIZED",
    });
    this.nodes.set("npci", {
      id: "npci",
      name: "NPCI Simulator Service",
      port: 8002,
      baseOffsetMs: -3420, // -3.42 seconds slow
      adjustedOffsetMs: 0,
      lastSyncTimestamp: null,
      status: "DESYNCHRONIZED",
    });
    this.nodes.set("receiver-bank", {
      id: "receiver-bank",
      name: "Receiver Bank Service",
      port: 8003,
      baseOffsetMs: 1850, // +1.85 seconds fast
      adjustedOffsetMs: 0,
      lastSyncTimestamp: null,
      status: "DESYNCHRONIZED",
    });
  }

  getClocks() {
    const now = Date.now();
    const result: Array<SimulatedClockNode & { currentTimeFormatted: string; effectiveOffsetMs: number }> = [];

    for (const node of this.nodes.values()) {
      const effectiveOffset = node.baseOffsetMs + node.adjustedOffsetMs;
      const simulatedEpoch = now + effectiveOffset;
      const simDate = new Date(simulatedEpoch);
      const hours = String(simDate.getHours()).padStart(2, "0");
      const mins = String(simDate.getMinutes()).padStart(2, "0");
      const secs = String(simDate.getSeconds()).padStart(2, "0");
      const ms = String(simDate.getMilliseconds()).padStart(3, "0");
      const currentTimeFormatted = `${hours}:${mins}:${secs}.${ms}`;

      result.push({
        ...node,
        effectiveOffsetMs: effectiveOffset,
        currentTimeFormatted,
      });
    }

    return result;
  }

  /**
   * Synchronize Clocks using Berkeley consensus:
   * Coordinator collects timestamps from all nodes, computes the average time skew,
   * and dispatches offset corrections so all nodes converge.
   */
  synchronize() {
    const now = Date.now();
    const offsets: number[] = [];

    for (const node of this.nodes.values()) {
      offsets.push(node.baseOffsetMs + node.adjustedOffsetMs);
    }

    // Compute average skew (Berkeley consensus)
    const averageOffset = Math.round(offsets.reduce((acc, v) => acc + v, 0) / offsets.length);

    // Apply adjustments so all node clocks align with the consensus average
    for (const node of this.nodes.values()) {
      const currentEffective = node.baseOffsetMs + node.adjustedOffsetMs;
      const delta = averageOffset - currentEffective;
      node.adjustedOffsetMs += delta;
      node.lastSyncTimestamp = now;
      node.status = "SYNCHRONIZED";
    }

    return {
      message: "Berkeley Clock Synchronization completed. Node clocks converged to consensus average.",
      consensusOffsetMs: averageOffset,
      clocks: this.getClocks(),
    };
  }

  introduceDrift(nodeId: string, driftMs: number) {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Unknown node: ${nodeId}`);
    node.adjustedOffsetMs += driftMs;
    node.status = Math.abs(node.baseOffsetMs + node.adjustedOffsetMs) > 100 ? "DESYNCHRONIZED" : "DRIFTING";
    return this.getClocks();
  }
}

// ----------------------------------------------------------------------------
// 2. Lamport's Logical Clock Algorithm
// ----------------------------------------------------------------------------

export class LamportClockManager {
  private clocks: Map<string, number> = new Map();
  private eventHistory: Array<{
    id: string;
    nodeId: string;
    eventType: "LOCAL" | "SEND" | "RECEIVE";
    clockBefore: number;
    clockAfter: number;
    description: string;
    timestamp: string;
    incomingTimestamp?: number;
  }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.clocks.set("sender-bank", 0);
    this.clocks.set("transaction-service", 0);
    this.clocks.set("npci", 0);
    this.clocks.set("receiver-bank", 0);
    this.eventHistory = [];
  }

  getClock(nodeId: string): number {
    return this.clocks.get(nodeId) || 0;
  }

  getAllClocks(): LamportNodeState[] {
    const names: Record<string, string> = {
      "sender-bank": "Sender Bank Service",
      "transaction-service": "Transaction Service",
      "npci": "NPCI Simulator",
      "receiver-bank": "Receiver Bank Service",
    };
    return Array.from(this.clocks.entries()).map(([id, clock]) => {
      const last = this.eventHistory.filter((e) => e.nodeId === id).slice(-1)[0];
      return {
        id,
        name: names[id] || id,
        clock,
        lastEvent: last?.description || "Initialized (L=0)",
        lastTimestamp: last?.timestamp || new Date().toISOString(),
      };
    });
  }

  getHistory(limit = 50) {
    return [...this.eventHistory].reverse().slice(0, limit);
  }

  /**
   * Rule 1 (Local event): L_i = L_i + 1
   */
  tickLocal(nodeId: string, description: string): number {
    const current = this.getClock(nodeId);
    const updated = current + 1;
    this.clocks.set(nodeId, updated);
    this.eventHistory.push({
      id: `LMP-EVT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      nodeId,
      eventType: "LOCAL",
      clockBefore: current,
      clockAfter: updated,
      description,
      timestamp: new Date().toISOString(),
    });
    return updated;
  }

  /**
   * Rule 2 (Send event): L_i = L_i + 1, attach L_i to outgoing message
   */
  tickSend(fromNodeId: string, toNodeId: string, description: string): number {
    const current = this.getClock(fromNodeId);
    const updated = current + 1;
    this.clocks.set(fromNodeId, updated);
    this.eventHistory.push({
      id: `LMP-EVT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      nodeId: fromNodeId,
      eventType: "SEND",
      clockBefore: current,
      clockAfter: updated,
      description: `${description} [Sent to ${toNodeId}]`,
      timestamp: new Date().toISOString(),
    });
    return updated;
  }

  /**
   * Rule 3 (Receive event with timestamp T): L_j = max(L_j, T) + 1
   */
  tickReceive(toNodeId: string, fromNodeId: string, incomingTimestamp: number, description: string): number {
    const current = this.getClock(toNodeId);
    const updated = Math.max(current, incomingTimestamp) + 1;
    this.clocks.set(toNodeId, updated);
    this.eventHistory.push({
      id: `LMP-EVT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      nodeId: toNodeId,
      eventType: "RECEIVE",
      clockBefore: current,
      clockAfter: updated,
      incomingTimestamp,
      description: `${description} [Received from ${fromNodeId}, T=${incomingTimestamp}]`,
      timestamp: new Date().toISOString(),
    });
    return updated;
  }
}

// ----------------------------------------------------------------------------
// 2b. Service-Level Transaction Interceptor (Lamport's Logical Clock)
// ----------------------------------------------------------------------------

export interface InterceptorAuditEntry {
  id: string;
  sequence: number;
  transactionId: string;
  sourceService: string;
  targetService: string;
  endpoint: string;
  action: string;
  direction: "OUTGOING_REQUEST" | "INCOMING_REQUEST" | "OUTGOING_RESPONSE" | "INCOMING_RESPONSE";
  lamportTimestamp: number;
  clockBefore: number;
  clockAfter: number;
  headers: Record<string, string>;
  timestamp: string;
  details?: string;
}

export interface InterServiceCallEnvelope<T = any> {
  sourceService: string;
  targetService: string;
  endpoint: string;
  action: string;
  transactionId: string;
  headers: Record<string, string>;
  payload: T;
  lamportTimestamp: number;
}

export class ServiceLevelLamportInterceptor {
  private lamport: LamportClockManager;
  private auditLog: InterceptorAuditEntry[] = [];
  private sequenceCounter = 0;

  constructor(lamport: LamportClockManager) {
    this.lamport = lamport;
  }

  getAuditLog(limit = 60): InterceptorAuditEntry[] {
    return [...this.auditLog].reverse().slice(0, limit);
  }

  getMetrics() {
    const totalRequests = this.auditLog.filter((e) => e.direction === "OUTGOING_REQUEST").length;
    const totalResponses = this.auditLog.filter((e) => e.direction === "OUTGOING_RESPONSE").length;
    return {
      active: true,
      protocol: "Lamport's Logical Clock Interceptor (Leslie Lamport 1978)",
      totalInterceptedRequests: totalRequests,
      totalInterceptedResponses: totalResponses,
      totalEventsIntercepted: this.auditLog.length,
      clocks: this.lamport.getAllClocks(),
      recentLogs: this.getAuditLog(15),
    };
  }

  /**
   * Increments logical clock value on any transaction event (Rule 1: L_i = L_i + 1)
   */
  recordEvent(serviceId: string, description: string): number {
    return this.lamport.tickLocal(serviceId, description);
  }

  /**
   * Prepares and intercepts an outgoing inter-service API request.
   * Increments sender's Lamport clock value (Rule 2: L_i = L_i + 1)
   * and attaches timestamp headers to outgoing request.
   */
  interceptOutgoingRequest(
    sourceService: string,
    targetService: string,
    endpoint: string,
    action: string,
    transactionId: string,
    payload: any = {}
  ): { headers: Record<string, string>; lamportTimestamp: number } {
    const clockBefore = this.lamport.getClock(sourceService);
    const lamportTimestamp = this.lamport.tickSend(
      sourceService,
      targetService,
      `[Interceptor] ${action} -> ${endpoint}`
    );

    const headers: Record<string, string> = {
      "x-lamport-clock": String(lamportTimestamp),
      "x-lamport-source": sourceService,
      "x-lamport-target": targetService,
      "x-transaction-id": transactionId,
      "x-interceptor-action": action,
      "x-interceptor-endpoint": endpoint,
      "x-interceptor-timestamp": new Date().toISOString(),
    };

    this.auditLog.push({
      id: `INT-OUT-${Date.now()}-${++this.sequenceCounter}`,
      sequence: this.sequenceCounter,
      transactionId,
      sourceService,
      targetService,
      endpoint,
      action,
      direction: "OUTGOING_REQUEST",
      lamportTimestamp,
      clockBefore,
      clockAfter: lamportTimestamp,
      headers,
      timestamp: new Date().toISOString(),
      details: `Attached Lamport timestamp L=${lamportTimestamp} to inter-service request ${sourceService} -> ${targetService}`,
    });

    return { headers, lamportTimestamp };
  }

  /**
   * Intercepts an incoming inter-service request at destination service.
   * Applies Lamport Rule 3: L_j = max(L_j, T) + 1
   */
  interceptIncomingRequest(
    targetService: string,
    sourceService: string,
    incomingTimestamp: number,
    endpoint: string,
    action: string,
    transactionId: string,
    headers: Record<string, string>
  ): { clockBefore: number; clockAfter: number } {
    const clockBefore = this.lamport.getClock(targetService);
    const clockAfter = this.lamport.tickReceive(
      targetService,
      sourceService,
      incomingTimestamp,
      `[Interceptor] Recv ${action} from ${sourceService}`
    );

    this.auditLog.push({
      id: `INT-IN-${Date.now()}-${++this.sequenceCounter}`,
      sequence: this.sequenceCounter,
      transactionId,
      sourceService,
      targetService,
      endpoint,
      action,
      direction: "INCOMING_REQUEST",
      lamportTimestamp: clockAfter,
      clockBefore,
      clockAfter,
      headers,
      timestamp: new Date().toISOString(),
      details: `Received request with T=${incomingTimestamp}; updated ${targetService} clock from ${clockBefore} to ${clockAfter}`,
    });

    return { clockBefore, clockAfter };
  }

  /**
   * Destination service sends back response/ACK with incremented Lamport timestamp
   */
  interceptOutgoingResponse(
    targetService: string,
    sourceService: string,
    endpoint: string,
    action: string,
    transactionId: string
  ): { headers: Record<string, string>; lamportTimestamp: number } {
    const clockBefore = this.lamport.getClock(targetService);
    const lamportTimestamp = this.lamport.tickSend(
      targetService,
      sourceService,
      `[Interceptor] ACK ${action} for ${transactionId}`
    );

    const headers: Record<string, string> = {
      "x-lamport-clock": String(lamportTimestamp),
      "x-lamport-source": targetService,
      "x-lamport-target": sourceService,
      "x-transaction-id": transactionId,
      "x-interceptor-status": "SUCCESS",
    };

    this.auditLog.push({
      id: `INT-RESP-OUT-${Date.now()}-${++this.sequenceCounter}`,
      sequence: this.sequenceCounter,
      transactionId,
      sourceService: targetService,
      targetService: sourceService,
      endpoint,
      action: `${action}_ACK`,
      direction: "OUTGOING_RESPONSE",
      lamportTimestamp,
      clockBefore,
      clockAfter: lamportTimestamp,
      headers,
      timestamp: new Date().toISOString(),
      details: `Attached Lamport timestamp L=${lamportTimestamp} to response ACK`,
    });

    return { headers, lamportTimestamp };
  }

  /**
   * Source service receives response/ACK and advances clock
   */
  interceptIncomingResponse(
    sourceService: string,
    targetService: string,
    responseTimestamp: number,
    endpoint: string,
    action: string,
    transactionId: string
  ): { clockBefore: number; clockAfter: number } {
    const clockBefore = this.lamport.getClock(sourceService);
    const clockAfter = this.lamport.tickReceive(
      sourceService,
      targetService,
      responseTimestamp,
      `[Interceptor] Received ACK ${action} from ${targetService}`
    );

    this.auditLog.push({
      id: `INT-RESP-IN-${Date.now()}-${++this.sequenceCounter}`,
      sequence: this.sequenceCounter,
      transactionId,
      sourceService: targetService,
      targetService: sourceService,
      endpoint,
      action: `${action}_ACK`,
      direction: "INCOMING_RESPONSE",
      lamportTimestamp: clockAfter,
      clockBefore,
      clockAfter,
      headers: { "x-lamport-clock": String(responseTimestamp) },
      timestamp: new Date().toISOString(),
      details: `Received ACK with T=${responseTimestamp}; advanced ${sourceService} clock to L=${clockAfter}`,
    });

    return { clockBefore, clockAfter };
  }

  /**
   * Executes a complete inter-service API call through the interceptor lifecycle:
   * 1. Outgoing send (increments clock, attaches timestamp headers)
   * 2. Destination receive (updates clock to max(current, incoming)+1)
   * 3. Service operation execution
   * 4. Outgoing response (increments clock, attaches timestamp)
   * 5. Source receive (updates clock)
   */
  async invokeInterService<T>(
    sourceService: string,
    targetService: string,
    endpoint: string,
    action: string,
    transactionId: string,
    payload: any,
    handler: (envelope: InterServiceCallEnvelope) => Promise<T>
  ): Promise<{ result: T; sendLamport: number; recvLamport: number; respLamport: number }> {
    const { headers, lamportTimestamp: sendLamport } = this.interceptOutgoingRequest(
      sourceService,
      targetService,
      endpoint,
      action,
      transactionId,
      payload
    );

    const { clockAfter: recvLamport } = this.interceptIncomingRequest(
      targetService,
      sourceService,
      sendLamport,
      endpoint,
      action,
      transactionId,
      headers
    );

    const envelope: InterServiceCallEnvelope = {
      sourceService,
      targetService,
      endpoint,
      action,
      transactionId,
      headers,
      payload,
      lamportTimestamp: recvLamport,
    };

    const result = await handler(envelope);

    const { lamportTimestamp: respLamport } = this.interceptOutgoingResponse(
      targetService,
      sourceService,
      endpoint,
      action,
      transactionId
    );

    this.interceptIncomingResponse(
      sourceService,
      targetService,
      respLamport,
      endpoint,
      action,
      transactionId
    );

    return { result, sendLamport, recvLamport, respLamport };
  }

  reset() {
    this.auditLog = [];
    this.sequenceCounter = 0;
  }
}

// ----------------------------------------------------------------------------
// 3. Vector Clock Algorithm
// ----------------------------------------------------------------------------

export class VectorClockManager {
  // 4 nodes: [0: Sender Bank, 1: Transaction Service, 2: NPCI, 3: Receiver Bank]
  private vectors: Map<string, VectorClock> = new Map();
  private eventHistory: Array<{
    id: string;
    nodeId: string;
    eventType: "LOCAL" | "SEND" | "RECEIVE";
    vectorBefore: VectorClock;
    vectorAfter: VectorClock;
    description: string;
    timestamp: string;
    incomingVector?: VectorClock;
  }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.vectors.set("sender-bank", [0, 0, 0, 0]);
    this.vectors.set("transaction-service", [0, 0, 0, 0]);
    this.vectors.set("npci", [0, 0, 0, 0]);
    this.vectors.set("receiver-bank", [0, 0, 0, 0]);
    this.eventHistory = [];
  }

  getVector(nodeId: string): VectorClock {
    return [...(this.vectors.get(nodeId) || [0, 0, 0, 0])] as VectorClock;
  }

  getAllVectors(): VectorNodeState[] {
    const names: Record<string, string> = {
      "sender-bank": "Sender Bank Service",
      "transaction-service": "Transaction Service",
      "npci": "NPCI Simulator",
      "receiver-bank": "Receiver Bank Service",
    };
    return Array.from(this.vectors.entries()).map(([id, vector]) => {
      const last = this.eventHistory.filter((e) => e.nodeId === id).slice(-1)[0];
      return {
        id,
        name: names[id] || id,
        vector: [...vector] as VectorClock,
        lastEvent: last?.description || "Initialized [0,0,0,0]",
        lastTimestamp: last?.timestamp || new Date().toISOString(),
      };
    });
  }

  getHistory(limit = 50) {
    return [...this.eventHistory].reverse().slice(0, limit);
  }

  /**
   * Local event on node k: V_k[k] = V_k[k] + 1
   */
  tickLocal(nodeId: string, description: string): VectorClock {
    const idx = NODE_INDICES[nodeId];
    if (idx === undefined) throw new Error(`Unknown node: ${nodeId}`);
    const before = this.getVector(nodeId);
    const after = [...before] as VectorClock;
    after[idx] += 1;
    this.vectors.set(nodeId, after);

    this.eventHistory.push({
      id: `VEC-EVT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      nodeId,
      eventType: "LOCAL",
      vectorBefore: before,
      vectorAfter: after,
      description,
      timestamp: new Date().toISOString(),
    });

    return after;
  }

  /**
   * Send event from node k: V_k[k] = V_k[k] + 1, attach copy of V_k to outgoing message
   */
  tickSend(fromNodeId: string, toNodeId: string, description: string): VectorClock {
    const idx = NODE_INDICES[fromNodeId];
    if (idx === undefined) throw new Error(`Unknown node: ${fromNodeId}`);
    const before = this.getVector(fromNodeId);
    const after = [...before] as VectorClock;
    after[idx] += 1;
    this.vectors.set(fromNodeId, after);

    this.eventHistory.push({
      id: `VEC-EVT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      nodeId: fromNodeId,
      eventType: "SEND",
      vectorBefore: before,
      vectorAfter: after,
      description: `${description} [Sent to ${toNodeId}]`,
      timestamp: new Date().toISOString(),
    });

    return after;
  }

  /**
   * Receive event at node k with vector W:
   * V_k[j] = max(V_k[j], W[j]) for all j
   * V_k[k] = V_k[k] + 1
   */
  tickReceive(toNodeId: string, fromNodeId: string, incomingVector: VectorClock, description: string): VectorClock {
    const idx = NODE_INDICES[toNodeId];
    if (idx === undefined) throw new Error(`Unknown node: ${toNodeId}`);
    const before = this.getVector(toNodeId);
    const after: VectorClock = [
      Math.max(before[0], incomingVector[0]),
      Math.max(before[1], incomingVector[1]),
      Math.max(before[2], incomingVector[2]),
      Math.max(before[3], incomingVector[3]),
    ];
    after[idx] += 1;
    this.vectors.set(toNodeId, after);

    this.eventHistory.push({
      id: `VEC-EVT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      nodeId: toNodeId,
      eventType: "RECEIVE",
      vectorBefore: before,
      vectorAfter: after,
      incomingVector: [...incomingVector] as VectorClock,
      description: `${description} [Received from ${fromNodeId}, V=${JSON.stringify(incomingVector)}]`,
      timestamp: new Date().toISOString(),
    });

    return after;
  }

  /**
   * Causal Relationship Evaluator
   * Returns:
   * "HAPPENS_BEFORE_A_B" if A -> B
   * "HAPPENS_BEFORE_B_A" if B -> A
   * "CONCURRENT" if A || B
   * "IDENTICAL" if A == B
   */
  static compare(vA: VectorClock, vB: VectorClock): {
    relation: "HAPPENS_BEFORE_A_B" | "HAPPENS_BEFORE_B_A" | "CONCURRENT" | "IDENTICAL";
    explanation: string;
  } {
    let aLessOrEqual = true;
    let bLessOrEqual = true;
    let identical = true;

    for (let i = 0; i < 4; i++) {
      if (vA[i] > vB[i]) aLessOrEqual = false;
      if (vB[i] > vA[i]) bLessOrEqual = false;
      if (vA[i] !== vB[i]) identical = false;
    }

    if (identical) {
      return {
        relation: "IDENTICAL",
        explanation: "Vectors are identical; representing the exact same logical state cut.",
      };
    }

    if (aLessOrEqual && !bLessOrEqual) {
      return {
        relation: "HAPPENS_BEFORE_A_B",
        explanation: "Event A causally happened-before Event B (A → B): Every component of V_A ≤ V_B and V_A ≠ V_B.",
      };
    }

    if (bLessOrEqual && !aLessOrEqual) {
      return {
        relation: "HAPPENS_BEFORE_B_A",
        explanation: "Event B causally happened-before Event A (B → A): Every component of V_B ≤ V_A and V_B ≠ V_A.",
      };
    }

    return {
      relation: "CONCURRENT",
      explanation: "Events A and B are concurrent (A ∥ B): Neither event causally precedes the other in the partial ordering.",
    };
  }
}

// ----------------------------------------------------------------------------
// 4. Beacon Protocol (Heartbeat-Based Failure Detection)
// ----------------------------------------------------------------------------

export class BeaconProtocolManager {
  private beacons: Map<string, BeaconState> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private onStateChangeCallback?: (beacons: BeaconState[]) => void;

  constructor() {
    this.initBeacons();
  }

  private initBeacons() {
    const nodes = [
      { id: "sender-bank", name: "Sender Bank Service", port: 8001 },
      { id: "transaction-service", name: "Transaction Service", port: 8000 },
      { id: "npci", name: "NPCI Simulator Service", port: 8002 },
      { id: "receiver-bank", name: "Receiver Bank Service", port: 8003 },
    ];

    const now = Date.now();
    for (const n of nodes) {
      this.beacons.set(n.id, {
        id: n.id,
        name: n.name,
        port: n.port,
        lastBeaconTime: new Date(now).toISOString(),
        lastBeaconEpochMs: now,
        beaconIntervalMs: 2000,
        timeoutThresholdMs: 5000,
        sequence: 1,
        status: "HEALTHY",
        consecutiveMisses: 0,
      });
    }
  }

  start(
    failureChecker: (nodeId: string) => boolean,
    onStateChange?: (beacons: BeaconState[]) => void
  ) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.onStateChangeCallback = onStateChange;

    // Pulse beacon heartbeats every 2 seconds
    this.timer = setInterval(() => {
      this.tickBeacons(failureChecker);
    }, 2000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  tickBeacons(failureChecker: (nodeId: string) => boolean) {
    const now = Date.now();
    let stateChanged = false;

    for (const [id, beacon] of this.beacons.entries()) {
      const isFailed = failureChecker(id);
      const oldStatus = beacon.status;

      if (isFailed) {
        // Suppress beacon emission
        const elapsed = now - beacon.lastBeaconEpochMs;
        beacon.consecutiveMisses = Math.floor(elapsed / beacon.beaconIntervalMs);

        if (elapsed > beacon.timeoutThresholdMs) {
          beacon.status = "UNREACHABLE";
        } else if (elapsed > beacon.beaconIntervalMs * 1.2) {
          beacon.status = "SUSPECTED";
        }
      } else {
        // Healthy heartbeat pulse
        const wasUnreachable = beacon.status === "UNREACHABLE" || beacon.status === "SUSPECTED";
        beacon.lastBeaconEpochMs = now;
        beacon.lastBeaconTime = new Date(now).toISOString();
        beacon.sequence += 1;
        beacon.consecutiveMisses = 0;
        beacon.status = wasUnreachable ? "RECOVERED" : "HEALTHY";
      }

      if (oldStatus !== beacon.status) {
        stateChanged = true;
      }
    }

    if (stateChanged && this.onStateChangeCallback) {
      this.onStateChangeCallback(this.getBeacons());
    }
  }

  getBeacons(): BeaconState[] {
    const now = Date.now();
    return Array.from(this.beacons.values()).map((b) => {
      const elapsed = now - b.lastBeaconEpochMs;
      let dynamicStatus = b.status;
      if (b.status !== "HEALTHY" && b.status !== "RECOVERED") {
        if (elapsed > b.timeoutThresholdMs) dynamicStatus = "UNREACHABLE";
        else if (elapsed > b.beaconIntervalMs * 1.2) dynamicStatus = "SUSPECTED";
      }
      return {
        ...b,
        status: dynamicStatus,
      };
    });
  }

  recordManualBeacon(nodeId: string) {
    const b = this.beacons.get(nodeId);
    if (!b) return null;
    const now = Date.now();
    b.lastBeaconEpochMs = now;
    b.lastBeaconTime = new Date(now).toISOString();
    b.sequence += 1;
    b.status = "HEALTHY";
    b.consecutiveMisses = 0;
    return b;
  }
}

// ----------------------------------------------------------------------------
// 5. Global State Snapshot (Chandy-Lamport Educational Simulator)
// ----------------------------------------------------------------------------

export class GlobalStateManager {
  private snapshots: GlobalSnapshot[] = [];

  captureSnapshot(
    lamportClock: number,
    vectorClock: VectorClock,
    activeTxn: any,
    users: any[],
    failureState: any
  ): GlobalSnapshot {
    const now = new Date().toISOString();
    const id = `SNAP-${Date.now().toString().slice(-6)}`;

    // Infer node states from active transaction and failure state
    let senderState = "IDLE";
    let txnServiceState = "IDLE";
    let npciState = "IDLE";
    let receiverState = "IDLE";

    let cHubSender = { inFlight: false, message: null as string | null };
    let cSenderHub = { inFlight: false, message: null as string | null };
    let cHubNpci = { inFlight: false, message: null as string | null };
    let cNpciReceiver = { inFlight: false, message: null as string | null };
    let cReceiverHub = { inFlight: false, message: null as string | null };

    if (activeTxn) {
      const st = activeTxn.status;
      if (st === "INITIATED" || st === "PROCESSING") {
        txnServiceState = "ORCHESTRATING_SAGA";
        senderState = failureState.sender_bank_failure ? "FAULT_503_OUTAGE" : "DEBIT_VERIFIED";
        cHubSender = { inFlight: true, message: `Debit Request: ₹${activeTxn.amount}` };
        npciState = failureState.npci_failure ? "SWITCH_UNREACHABLE" : "ROUTING_SWITCH";
        cHubNpci = { inFlight: true, message: `Switch Routing: ${activeTxn.senderId} -> ${activeTxn.receiverId}` };
        receiverState = failureState.receiver_bank_failure ? "FAULT_503_OUTAGE" : "AWAITING_SETTLEMENT";
      } else if (st === "SUCCESS") {
        txnServiceState = "SETTLED_COMPLETED";
        senderState = "DEBIT_SETTLED";
        npciState = "ROUTE_CLEARED";
        receiverState = "CREDIT_CONFIRMED";
      } else if (st === "FAILED" || st === "ROLLBACK_COMPLETED") {
        txnServiceState = "COMPENSATING_ROLLBACK";
        senderState = "DEBIT_ROLLED_BACK";
        npciState = "ROUTE_ABORTED";
        receiverState = "ABORTED_NO_CREDIT";
      }
    }

    const sanikaUser = users.find((u) => u.upi_id === "sanika@bank") || { balance: 10000 };
    const navyaUser = users.find((u) => u.upi_id === "navya@bank") || { balance: 5000 };

    const snapshot: GlobalSnapshot = {
      snapshotId: id,
      timestamp: now,
      lamportTime: lamportClock,
      vectorTime: [...vectorClock] as VectorClock,
      activeTransactionId: activeTxn?.transactionId || null,
      nodeStates: {
        senderBank: {
          state: senderState,
          balance: sanikaUser.balance,
          lastAction: `Sender balance: ₹${sanikaUser.balance}`,
        },
        transactionService: {
          state: txnServiceState,
          activeTxns: activeTxn ? 1 : 0,
          lastAction: activeTxn ? `Transaction ${activeTxn.transactionId} (${activeTxn.status})` : "Standing by for UPI Intent",
        },
        npci: {
          state: npciState,
          routingQueue: activeTxn?.status === "PROCESSING" ? 1 : 0,
          lastAction: "Interbank Switch operational",
        },
        receiverBank: {
          state: receiverState,
          creditsRecorded: navyaUser.balance,
          lastAction: `Beneficiary balance: ₹${navyaUser.balance}`,
        },
      },
      channelStates: {
        clientToHub: { inFlight: activeTxn?.status === "INITIATED", message: activeTxn ? `Intent: ₹${activeTxn.amount}` : null },
        hubToSender: cHubSender,
        senderToHub: cSenderHub,
        hubToNpci: cHubNpci,
        npciToReceiver: cNpciReceiver,
        receiverToHub: cReceiverHub,
        directP2P: { inFlight: activeTxn?.mode === "p2p", message: activeTxn?.mode === "p2p" ? "Direct Peer HTTP Stream" : null },
      },
      consistent: true,
      notes: "Consistent global snapshot cut: Recorded across distributed nodes and message communication channels with zero causal anomalies.",
    };

    this.snapshots.unshift(snapshot);
    if (this.snapshots.length > 20) {
      this.snapshots.pop();
    }

    return snapshot;
  }

  getSnapshots() {
    return this.snapshots;
  }
}

// ----------------------------------------------------------------------------
// 6. Election Algorithms (Bully & Ring Algorithms)
// ----------------------------------------------------------------------------

export interface ElectionTraceStep {
  step: number;
  from: string;
  to: string;
  type: "ELECTION" | "OK" | "COORDINATOR" | "TOKEN";
  message: string;
  timestamp: string;
}

export interface ElectionResult {
  algorithm: "Bully" | "Ring";
  initiator: string;
  crashedNode: string;
  electedCoordinator: string;
  trace: ElectionTraceStep[];
  explanation: string;
}

export class ElectionAlgorithmManager {
  private nodes = [
    { id: "sender-bank", name: "Sender Bank", priority: 1 },
    { id: "transaction-service", name: "Transaction Service", priority: 2 },
    { id: "npci", name: "NPCI Switch", priority: 3 },
    { id: "receiver-bank", name: "Receiver Bank", priority: 4 },
  ];

  runBullyElection(initiatorId = "sender-bank", crashedNodeId = "receiver-bank"): ElectionResult {
    const trace: ElectionTraceStep[] = [];
    let stepNum = 1;
    const now = () => new Date().toISOString();

    const activeNodes = this.nodes.filter((n) => n.id !== crashedNodeId);
    const initiator = this.nodes.find((n) => n.id === initiatorId) || this.nodes[0];

    trace.push({
      step: stepNum++,
      from: initiator.id,
      to: "BROADCAST",
      type: "ELECTION",
      message: `${initiator.name} (Priority ${initiator.priority}) detected coordinator failure (${crashedNodeId}). Initiates Bully election.`,
      timestamp: now(),
    });

    // Send ELECTION to all higher priority nodes
    const higherNodes = activeNodes.filter((n) => n.priority > initiator.priority);

    let highestActive = initiator;

    if (higherNodes.length > 0) {
      for (const target of higherNodes) {
        trace.push({
          step: stepNum++,
          from: initiator.id,
          to: target.id,
          type: "ELECTION",
          message: `${initiator.name} sends ELECTION challenge to higher priority node ${target.name} (Priority ${target.priority}).`,
          timestamp: now(),
        });

        trace.push({
          step: stepNum++,
          from: target.id,
          to: initiator.id,
          type: "OK",
          message: `${target.name} responds 'OK' to ${initiator.name} and takes over the election.`,
          timestamp: now(),
        });
      }

      // The highest priority active node wins
      highestActive = higherNodes.reduce((prev, curr) => (curr.priority > prev.priority ? curr : prev));

      trace.push({
        step: stepNum++,
        from: highestActive.id,
        to: "BROADCAST",
        type: "COORDINATOR",
        message: `${highestActive.name} (Priority ${highestActive.priority}) has the highest priority among active nodes and declares itself COORDINATOR!`,
        timestamp: now(),
      });
    } else {
      // Initiator is already highest active
      trace.push({
        step: stepNum++,
        from: initiator.id,
        to: "BROADCAST",
        type: "COORDINATOR",
        message: `No higher priority active nodes found. ${initiator.name} declares victory as the new COORDINATOR!`,
        timestamp: now(),
      });
    }

    return {
      algorithm: "Bully",
      initiator: initiator.id,
      crashedNode: crashedNodeId,
      electedCoordinator: highestActive.id,
      trace,
      explanation: `In the Bully Algorithm, any process that notices coordinator failure sends an ELECTION message to all processes with higher priority numbers. If no process responds, it bullies everyone and crowns itself coordinator. If a higher process responds with OK, that higher process takes over. Here, ${highestActive.name} (Priority ${highestActive.priority}) was elected coordinator.`,
    };
  }

  runRingElection(initiatorId = "sender-bank", crashedNodeId = "npci"): ElectionResult {
    const trace: ElectionTraceStep[] = [];
    let stepNum = 1;
    const now = () => new Date().toISOString();

    const ring = [...this.nodes];
    const activeNodes = ring.filter((n) => n.id !== crashedNodeId);
    const initiator = ring.find((n) => n.id === initiatorId) || activeNodes[0];

    const visitedIds = [initiator.id];
    let maxIdNode = initiator;

    trace.push({
      step: stepNum++,
      from: initiator.id,
      to: "RING_NEXT",
      type: "ELECTION",
      message: `${initiator.name} notices coordinator failure (${crashedNodeId}) and circulates ELECTION token [${visitedIds.join(", ")}] around the logical ring.`,
      timestamp: now(),
    });

    let current = initiator;
    for (let i = 0; i < ring.length; i++) {
      const currIdx = ring.findIndex((n) => n.id === current.id);
      let nextIdx = (currIdx + 1) % ring.length;
      let nextNode = ring[nextIdx];

      // Skip crashed node in ring
      if (nextNode.id === crashedNodeId) {
        trace.push({
          step: stepNum++,
          from: current.id,
          to: nextNode.id,
          type: "ELECTION",
          message: `${current.name} detects ${nextNode.name} is unresponsive (Crashed). Bypassing in logical ring.`,
          timestamp: now(),
        });
        nextIdx = (nextIdx + 1) % ring.length;
        nextNode = ring[nextIdx];
      }

      if (nextNode.id === initiator.id) {
        // Complete circle
        break;
      }

      visitedIds.push(nextNode.id);
      if (nextNode.priority > maxIdNode.priority) {
        maxIdNode = nextNode;
      }

      trace.push({
        step: stepNum++,
        from: current.id,
        to: nextNode.id,
        type: "TOKEN",
        message: `Token passes to ${nextNode.name}. Active list: [${visitedIds.join(", ")}]. Current max priority: ${maxIdNode.name} (${maxIdNode.priority}).`,
        timestamp: now(),
      });

      current = nextNode;
    }

    trace.push({
      step: stepNum++,
      from: initiator.id,
      to: "RING_BROADCAST",
      type: "COORDINATOR",
      message: `Election token returned to ${initiator.name}. Maximum priority process is ${maxIdNode.name} (Priority ${maxIdNode.priority}). COORDINATOR token circulated to announce victory.`,
      timestamp: now(),
    });

    return {
      algorithm: "Ring",
      initiator: initiator.id,
      crashedNode: crashedNodeId,
      electedCoordinator: maxIdNode.id,
      trace,
      explanation: `In the Ring Algorithm, processes are logically organized in a ring. When coordinator failure is detected, an ELECTION token is passed sequentially around the active ring collecting process IDs. Once the token returns to the initiator, the process with the highest ID is elected and a COORDINATOR token is circulated. Here, ${maxIdNode.name} (Priority ${maxIdNode.priority}) won.`,
    };
  }
}

// ----------------------------------------------------------------------------
// 7. Distributed Mutual Exclusion Algorithms
// ----------------------------------------------------------------------------

export interface MutexRequestResult {
  algorithm: "Ricart-Agrawala" | "Token-Ring";
  requestingNode: string;
  resource: string;
  granted: boolean;
  messagesExchanged: number;
  trace: { step: number; event: string; detail: string }[];
  selfStudyNote: string;
}

export class DistributedMutexManager {
  private currentLockHolder: string | null = null;
  private queue: string[] = [];

  requestLock(nodeId: string, algorithm: "Ricart-Agrawala" | "Token-Ring" = "Ricart-Agrawala"): MutexRequestResult {
    const trace = [];
    let step = 1;

    trace.push({
      step: step++,
      event: "REQUEST_INITIATED",
      detail: `${nodeId} requests exclusive mutual exclusion lock for atomic core-banking ledger mutation.`,
    });

    if (algorithm === "Ricart-Agrawala") {
      trace.push({
        step: step++,
        event: "TIMESTAMPED_REQUEST_BROADCAST",
        detail: `${nodeId} multicasts REQUEST(timestamp=T, nodeId=${nodeId}) to all other distributed bank nodes.`,
      });

      if (!this.currentLockHolder) {
        this.currentLockHolder = nodeId;
        trace.push({
          step: step++,
          event: "ALL_REPLIES_RECEIVED",
          detail: `All participating nodes reply with OK. ${nodeId} enters Critical Section (CS) to mutate account balance.`,
        });

        return {
          algorithm: "Ricart-Agrawala",
          requestingNode: nodeId,
          resource: "Core-Banking Account Ledger Lock",
          granted: true,
          messagesExchanged: 6, // 2*(N-1) messages for N=4
          trace,
          selfStudyNote: "Ricart-Agrawala requires 2*(N-1) messages per CS entry using Lamport timestamps for causal priority. Lodha & Kshemkalyani's fair algorithm further optimizes message complexity by restricting request forwarding.",
        };
      } else {
        this.queue.push(nodeId);
        trace.push({
          step: step++,
          event: "DEFERRED_REPLY",
          detail: `Lock is currently held by ${this.currentLockHolder}. Reply deferred. ${nodeId} queued in FIFO waiter queue.`,
        });

        return {
          algorithm: "Ricart-Agrawala",
          requestingNode: nodeId,
          resource: "Core-Banking Account Ledger Lock",
          granted: false,
          messagesExchanged: 3,
          trace,
          selfStudyNote: "When a process holding CS receives a request with lower timestamp priority, it defers its reply until it exits the Critical Section.",
        };
      }
    } else {
      // Token Ring
      trace.push({
        step: step++,
        event: "TOKEN_RING_CIRCULATION",
        detail: `Mutual exclusion token is circulating sequentially through Bank Nodes.`,
      });

      this.currentLockHolder = nodeId;
      trace.push({
        step: step++,
        event: "TOKEN_SEIZED",
        detail: `${nodeId} seized circulating token and entered Critical Section.`,
      });

      return {
        algorithm: "Token-Ring",
        requestingNode: nodeId,
        resource: "Core-Banking Account Ledger Lock",
        granted: true,
        messagesExchanged: 4,
        trace,
        selfStudyNote: "In Token Ring mutual exclusion, only the holder of the circulating token may enter the critical section. No starvation is possible as the token rotates predictably.",
      };
    }
  }

  releaseLock(nodeId: string) {
    if (this.currentLockHolder === nodeId) {
      this.currentLockHolder = null;
      const next = this.queue.shift();
      if (next) {
        this.currentLockHolder = next;
        return { releasedBy: nodeId, nextHolder: next };
      }
      return { releasedBy: nodeId, nextHolder: null };
    }
    return { releasedBy: nodeId, message: "Node was not holding lock" };
  }
}
