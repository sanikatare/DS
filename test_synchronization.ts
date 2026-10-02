// ============================================================================
// Automated Test Suite for UNIT III & UNIT IV Distributed Systems Algorithms
// Tests: Lamport Clocks, Vector Clocks, Clock Sync, Global State, Beacon
// ============================================================================

import {
  ClockSyncManager,
  LamportClockManager,
  VectorClockManager,
  BeaconProtocolManager,
  GlobalStateManager,
} from "./src/server/synchronization.ts";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ TEST FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

console.log("\n============================================================");
console.log("RUNNING DISTRIBUTED SYSTEMS ALGORITHM TESTS");
console.log("============================================================\n");

// ----------------------------------------------------------------------------
// 1. Lamport's Logical Clock Algorithm Tests
// ----------------------------------------------------------------------------
console.log("--- 1. Testing Lamport's Logical Clock Algorithm ---");
const lamport = new LamportClockManager();
assert(lamport.getClock("sender-bank") === 0, "Initial clock of sender-bank is 0");

// Local event increments clock: L = L + 1
const l1 = lamport.tickLocal("transaction-service", "Create transaction intent");
assert(l1 === 1, "Local event on transaction-service increments clock to 1");
assert(lamport.getClock("transaction-service") === 1, "Clock state updated to 1");

// Send event increments clock: L = L + 1
const lSend = lamport.tickSend("transaction-service", "sender-bank", "Debit Request");
assert(lSend === 2, "Send event increments transaction-service clock to 2");

// Receive event applies max(L_local, T_incoming) + 1
// sender-bank is currently 0, incoming is 2 -> max(0, 2) + 1 = 3
const lRecv = lamport.tickReceive("sender-bank", "transaction-service", lSend, "Debit Received");
assert(lRecv === 3, "Receive on sender-bank applies max(0, 2) + 1 = 3");
assert(lamport.getClock("sender-bank") === 3, "Sender bank clock is now 3");

// Further local event on sender-bank: 3 -> 4
const lDebit = lamport.tickLocal("sender-bank", "Balance debited atomically");
assert(lDebit === 4, "Atomic debit on sender-bank increments clock to 4");

// Sender bank sends ack back to transaction-service: 4 -> 5
const lAckSend = lamport.tickSend("sender-bank", "transaction-service", "Debit ACK");
assert(lAckSend === 5, "Send ACK increments clock to 5");

// Transaction service receives: currently at 2, incoming is 5 -> max(2, 5) + 1 = 6
const lAckRecv = lamport.tickReceive("transaction-service", "sender-bank", lAckSend, "Debit ACK Received");
assert(lAckRecv === 6, "Receive ACK on transaction-service applies max(2, 5) + 1 = 6");

// Verify causal order is strictly monotonic along communication path
assert(l1 < lSend && lSend < lRecv && lRecv < lDebit && lDebit < lAckSend && lAckSend < lAckRecv,
  "Causal ordering preserved across Lamport chain: 1 < 2 < 3 < 4 < 5 < 6");

// ----------------------------------------------------------------------------
// 2. Vector Clock Algorithm Tests
// ----------------------------------------------------------------------------
console.log("\n--- 2. Testing Vector Clock Algorithm ---");
const vector = new VectorClockManager();
// Order: [0: sender-bank, 1: transaction-service, 2: npci, 3: receiver-bank]
assert(JSON.stringify(vector.getVector("sender-bank")) === JSON.stringify([0, 0, 0, 0]), "Initial vector is [0,0,0,0]");

// Local event on Transaction Service (index 1)
const vTxn1 = vector.tickLocal("transaction-service", "Transaction Initiated");
assert(JSON.stringify(vTxn1) === JSON.stringify([0, 1, 0, 0]), "Txn local event yields [0,1,0,0]");

// Send message from Transaction Service to Sender Bank
const vTxnSend = vector.tickSend("transaction-service", "sender-bank", "Send Debit Request");
assert(JSON.stringify(vTxnSend) === JSON.stringify([0, 2, 0, 0]), "Txn send event yields [0,2,0,0]");

// Receive message at Sender Bank (index 0) with incoming vector [0,2,0,0]
// V[j] = max(before[j], incoming[j]), then V[0] = V[0] + 1
// before=[0,0,0,0] -> max=[0,2,0,0] -> increment index 0 -> [1,2,0,0]
const vSndRecv = vector.tickReceive("sender-bank", "transaction-service", vTxnSend, "Received Debit Request");
assert(JSON.stringify(vSndRecv) === JSON.stringify([1, 2, 0, 0]), "Sender receive yields merged vector [1,2,0,0]");

// Local event at Sender Bank: [1,2,0,0] -> [2,2,0,0]
const vSndDebit = vector.tickLocal("sender-bank", "Debit Confirmed");
assert(JSON.stringify(vSndDebit) === JSON.stringify([2, 2, 0, 0]), "Sender debit yields [2,2,0,0]");

// Test Vector Comparison: Happens-Before and Concurrency
const cmp1 = VectorClockManager.compare([0, 1, 0, 0], [1, 2, 0, 0]);
assert(cmp1.relation === "HAPPENS_BEFORE_A_B", "Happens-before identified correctly: [0,1,0,0] -> [1,2,0,0]");

const cmp2 = VectorClockManager.compare([1, 2, 0, 0], [0, 1, 0, 0]);
assert(cmp2.relation === "HAPPENS_BEFORE_B_A", "Happens-before identified correctly in reverse: [1,2,0,0] <- [0,1,0,0]");

// Concurrent events: two independent local events on different nodes
const vA: [number, number, number, number] = [2, 1, 0, 0];
const vB: [number, number, number, number] = [1, 3, 0, 0];
const cmpConcurrent = VectorClockManager.compare(vA, vB);
assert(cmpConcurrent.relation === "CONCURRENT", "Concurrent events detected: [2,1,0,0] ∥ [1,3,0,0]");

// ----------------------------------------------------------------------------
// 3. Simulated Physical Clock Synchronization Tests
// ----------------------------------------------------------------------------
console.log("\n--- 3. Testing Clock Synchronization (Berkeley Consensus) ---");
const clockSync = new ClockSyncManager();
const initialClocks = clockSync.getClocks();
assert(initialClocks.length === 4, "4 distributed nodes registered for clock sync");

const senderClock = initialClocks.find((c) => c.id === "sender-bank")!;
const npciClock = initialClocks.find((c) => c.id === "npci")!;
assert(senderClock.effectiveOffsetMs === -2150, "Sender bank initial clock offset is -2150ms");
assert(npciClock.effectiveOffsetMs === -3420, "NPCI initial clock offset is -3420ms");

// Run clock synchronization
const syncResult = clockSync.synchronize();
assert(syncResult.clocks.length === 4, "Sync returned 4 adjusted clocks");

const adjustedOffsets = syncResult.clocks.map((c) => c.effectiveOffsetMs);
const allAligned = adjustedOffsets.every((val) => Math.abs(val - syncResult.consensusOffsetMs) <= 1);
assert(allAligned, "All clocks converged to common consensus offset after synchronization");

// Introduce skew/drift
clockSync.introduceDrift("sender-bank", 1500);
const drifted = clockSync.getClocks().find((c) => c.id === "sender-bank")!;
assert(drifted.status === "DESYNCHRONIZED", "Drifted node status correctly reflects DESYNCHRONIZED");

// Re-synchronize
clockSync.synchronize();
const reSynced = clockSync.getClocks().find((c) => c.id === "sender-bank")!;
assert(reSynced.status === "SYNCHRONIZED", "Re-synchronization converges drifted node back to SYNCHRONIZED");

// ----------------------------------------------------------------------------
// 4. Global State Snapshot (Chandy-Lamport Educational Simulator)
// ----------------------------------------------------------------------------
console.log("\n--- 4. Testing Global State Snapshot ---");
const globalState = new GlobalStateManager();
const dummyUsers = [
  { upi_id: "sanika@bank", balance: 9500 },
  { upi_id: "navya@bank", balance: 5500 },
];
const dummyActiveTxn = {
  transactionId: "TXN-TEST-001",
  amount: 500,
  status: "PROCESSING",
  senderId: "sanika@bank",
  receiverId: "navya@bank",
};
const dummyFailures = { sender_bank_failure: false, npci_failure: false, receiver_bank_failure: false };

const snapshot = globalState.captureSnapshot(6, [2, 3, 1, 0], dummyActiveTxn, dummyUsers, dummyFailures);
assert(snapshot.snapshotId.startsWith("SNAP-"), "Snapshot ID generated correctly");
assert(snapshot.lamportTime === 6, "Snapshot captured Lamport clock cut L=6");
assert(JSON.stringify(snapshot.vectorTime) === JSON.stringify([2, 3, 1, 0]), "Snapshot captured Vector clock cut");
assert(snapshot.nodeStates.senderBank.state === "DEBIT_VERIFIED", "Sender bank state captured in snapshot cut");
assert(snapshot.nodeStates.npci.state === "ROUTING_SWITCH", "NPCI routing state captured in snapshot cut");
assert(snapshot.channelStates.hubToSender.inFlight === true, "In-flight channel message captured in cut");
assert(snapshot.consistent === true, "Snapshot is verified as causally consistent cut");

// ----------------------------------------------------------------------------
// 5. Beacon Protocol (Failure Detection) Tests
// ----------------------------------------------------------------------------
console.log("\n--- 5. Testing Beacon Protocol Failure Detection ---");
const beaconMgr = new BeaconProtocolManager();
const initialBeacons = beaconMgr.getBeacons();
assert(initialBeacons.length === 4, "4 nodes initialized for beacon protocol");
assert(initialBeacons.every((b) => b.status === "HEALTHY"), "All nodes initially HEALTHY");

// Simulate failure check where npci is failed
const failureChecker = (id: string) => id === "npci";

// Tick 1 (2s elapsed) - npci missed beacon
beaconMgr.tickBeacons(failureChecker);
// Fast forward epoch to trigger timeout threshold (>5000ms)
const npciBeacon = (beaconMgr as any).beacons.get("npci");
npciBeacon.lastBeaconEpochMs -= 5500;

beaconMgr.tickBeacons(failureChecker);
const beaconsAfterTimeout = beaconMgr.getBeacons();
const npciStatus = beaconsAfterTimeout.find((b) => b.id === "npci")?.status;
assert(npciStatus === "UNREACHABLE", "NPCI detected as UNREACHABLE after beacon timeout threshold");

// Recover npci
const recoveredChecker = (_id: string) => false;
beaconMgr.tickBeacons(recoveredChecker);
const beaconsAfterRecovery = beaconMgr.getBeacons();
const npciRecovered = beaconsAfterRecovery.find((b) => b.id === "npci")?.status;
assert(npciRecovered === "RECOVERED", "NPCI status transitions to RECOVERED when beacons resume");

console.log("\n============================================================");
console.log("ALL 5 UNIT III SYNCHRONIZATION ALGORITHM TEST SUITES PASSED!");
console.log("============================================================\n");
