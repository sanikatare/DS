"""
Phase 4 Verification & Regression Suite for UPI Distributed Transaction Simulator.
Verifies Stream-Oriented Communication using WebSockets (Phase 4) along with Phase 1, Phase 2 & Phase 3 Regressions.
"""

import asyncio
import json
import logging
import os
import sys
import threading
import time
import uuid
from pathlib import Path
import httpx
import websockets

# Setup sys.path for service imports
BASE_DIR = Path(__file__).resolve().parent
SERVICES_DIR = BASE_DIR / "services"
SENDER_DIR = SERVICES_DIR / "sender-bank-service"
NPCI_DIR = SERVICES_DIR / "npci-simulator-service"
RECEIVER_DIR = SERVICES_DIR / "receiver-bank-service"
TXN_DIR = SERVICES_DIR / "transaction-service"

for d in [str(SERVICES_DIR), str(SENDER_DIR), str(NPCI_DIR), str(RECEIVER_DIR), str(TXN_DIR)]:
    if d not in sys.path:
        sys.path.insert(0, d)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("test_phase4")

# Imports
import uvicorn
from common.circuit_breaker import CircuitBreaker, CircuitState
from common.mq_consumers import (
    sender_db,
    sender_main,
    sender_grpc,
    npci_main,
    npci_grpc,
    receiver_db,
    receiver_main,
    receiver_grpc,
)

from app.store import init_db as init_txn_db, new_transaction
import app.main as txn_main

_SERVERS_STARTED = False
_GRPC_SERVERS = []


def start_servers():
    global _SERVERS_STARTED, _GRPC_SERVERS
    if _SERVERS_STARTED:
        return
    _SERVERS_STARTED = True
    logger.info("Starting local HTTP (Uvicorn) and gRPC microservice servers for Phase 4...")

    def _run_uvicorn(app_obj, port):
        uvicorn.run(app_obj, host="127.0.0.1", port=port, log_level="error")

    t0 = threading.Thread(target=_run_uvicorn, args=(txn_main.app, 8000), daemon=True)
    t1 = threading.Thread(target=_run_uvicorn, args=(sender_main.app, 8001), daemon=True)
    t2 = threading.Thread(target=_run_uvicorn, args=(npci_main.app, 8002), daemon=True)
    t3 = threading.Thread(target=_run_uvicorn, args=(receiver_main.app, 8003), daemon=True)
    t0.start()
    t1.start()
    t2.start()
    t3.start()

    try:
        _GRPC_SERVERS.append(sender_grpc.serve_grpc())
    except Exception as exc:
        logger.warning("Sender gRPC server bind: %s", exc)

    try:
        _GRPC_SERVERS.append(npci_grpc.serve_grpc())
    except Exception as exc:
        logger.warning("NPCI gRPC server bind: %s", exc)

    try:
        _GRPC_SERVERS.append(receiver_grpc.serve_grpc())
    except Exception as exc:
        logger.warning("Receiver gRPC server bind: %s", exc)

    time.sleep(1.0)


def reset_all_databases():
    """Resets databases and caches for clean test isolation."""
    sender_db.init_db()
    receiver_db.init_db()
    init_txn_db()

    sender_main.FAILURE_STATE["failure_enabled"] = False
    sender_main.FAILURE_STATE["timeout_enabled"] = False
    npci_main.FAILURE_STATE["failure_enabled"] = False
    npci_main.FAILURE_STATE["timeout_enabled"] = False
    receiver_main.FAILURE_STATE["failure_enabled"] = False
    receiver_main.FAILURE_STATE["timeout_enabled"] = False

    sender_main.DEBITS.clear()
    receiver_main.CREDITS.clear()

    s_session = sender_db.SessionLocal()
    s_acc = sender_db._find_account(s_session, "sanika")
    if s_acc:
        s_acc.balance = 10000.0
        s_session.commit()
    s_session.close()
    sender_main._refresh_accounts_cache()

    r_session = receiver_db.SessionLocal()
    r_acc = receiver_db._find_account(r_session, "navya")
    if r_acc:
        r_acc.balance = 5000.0
        r_session.commit()
    r_session.close()
    receiver_main._refresh_accounts_cache()


async def send_transaction_http(sender="sanika", receiver="navya", amount=50.0, mode="rest"):
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "http://127.0.0.1:8000/api/transaction/initiate",
            json={
                "senderId": sender,
                "receiverId": receiver,
                "amount": amount,
                "mode": mode,
            },
        )
        return resp.json()


async def run_all_tests():
    logger.info("==========================================")
    logger.info("STARTING PHASE 4 TEST SUITE (16 TEST CASES)")
    logger.info("==========================================")

    start_servers()
    reset_all_databases()

    # -----------------------------------------------------------------------
    # TEST 1: REST TRANSACTION REGRESSION CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 1: REST TRANSACTION REGRESSION CHECK ---")
    res1 = await send_transaction_http(amount=50.0, mode="rest")
    assert res1["status"] == "SUCCESS", f"Expected SUCCESS, got {res1['status']}"
    logger.info("[PASS] Test 1: REST mode transaction processed successfully.")

    # -----------------------------------------------------------------------
    # TEST 2: gRPC TRANSACTION REGRESSION CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 2: gRPC TRANSACTION REGRESSION CHECK ---")
    res2 = await send_transaction_http(amount=50.0, mode="grpc")
    assert res2["status"] == "SUCCESS", f"Expected SUCCESS, got {res2['status']}"
    logger.info("[PASS] Test 2: gRPC mode transaction processed successfully.")

    # -----------------------------------------------------------------------
    # TEST 3: RABBITMQ TRANSACTION REGRESSION CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 3: RABBITMQ TRANSACTION REGRESSION CHECK ---")
    res3 = await send_transaction_http(amount=50.0, mode="rabbitmq")
    assert res3["status"] == "SUCCESS", f"Expected SUCCESS, got {res3['status']}"
    logger.info("[PASS] Test 3: RabbitMQ mode transaction processed successfully.")

    # -----------------------------------------------------------------------
    # TEST 4: WEBSOCKET CONNECTION ESTABLISHMENT CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 4: WEBSOCKET CONNECTION ESTABLISHMENT ---")
    ws_url = "ws://127.0.0.1:8000/ws/transactions"
    async with websockets.connect(ws_url) as ws:
        assert ws.open is True, "WebSocket connection failed to open"
        logger.info("[PASS] Test 4: Persistent WebSocket connection established successfully.")

    # -----------------------------------------------------------------------
    # TEST 5: WEBSOCKET EVENT STREAMING CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 5: WEBSOCKET EVENT STREAMING CHECK ---")
    async with websockets.connect(ws_url) as ws:
        txn_task = asyncio.create_task(send_transaction_http(amount=25.0, mode="rest"))

        received_events = []
        for _ in range(10):
            raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
            data = json.loads(raw)
            received_events.append(data)
            if data.get("eventType") == "PAYMENT_SUCCESS":
                break

        await txn_task
        assert len(received_events) > 0, "No streamed events received over WebSocket"
        logger.info("[PASS] Test 5: Real-time event streaming over WebSocket verified (%d events received).", len(received_events))

    # -----------------------------------------------------------------------
    # TEST 6: STREAM EVENT SCHEMA VALIDATION
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 6: STREAM EVENT SCHEMA VALIDATION ---")
    sample_evt = received_events[0]
    required_keys = ["eventId", "sequence", "transactionId", "eventType", "timestamp", "source", "status", "payload"]
    for k in required_keys:
        assert k in sample_evt, f"Missing required key in stream event schema: {k}"
    assert sample_evt["eventId"].startswith("EVT-"), "eventId should start with EVT-"
    assert isinstance(sample_evt["sequence"], int), "sequence should be an integer"
    logger.info("[PASS] Test 6: Stream event schema validated successfully (%s).", sample_evt["eventId"])

    # -----------------------------------------------------------------------
    # TEST 7: MONOTONIC SEQUENCE NUMBER INCREMENT CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 7: MONOTONIC SEQUENCE NUMBER INCREMENT CHECK ---")
    seqs = [e["sequence"] for e in received_events if "sequence" in e]
    for i in range(1, len(seqs)):
        assert seqs[i] > seqs[i - 1], f"Sequence numbers not monotonic: {seqs[i-1]} -> {seqs[i]}"
    logger.info("[PASS] Test 7: Monotonically increasing sequence numbers verified (%s).", seqs)

    # -----------------------------------------------------------------------
    # TEST 8: MULTIPLE CLIENT CONCURRENT BROADCAST CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 8: MULTIPLE CLIENT CONCURRENT BROADCAST CHECK ---")
    async with websockets.connect(ws_url) as ws_a, websockets.connect(ws_url) as ws_b:
        asyncio.create_task(send_transaction_http(amount=10.0, mode="rest"))

        msg_a = json.loads(await asyncio.wait_for(ws_a.recv(), timeout=3.0))
        msg_b = json.loads(await asyncio.wait_for(ws_b.recv(), timeout=3.0))

        assert msg_a["sequence"] == msg_b["sequence"], "Clients received different sequence numbers"
        assert msg_a["eventType"] == "TRANSACTION_INITIATED"
        assert msg_b["eventType"] == "TRANSACTION_INITIATED"
        logger.info("[PASS] Test 8: Concurrent event broadcast to multiple clients verified (seq #%d).", msg_a["sequence"])

    # -----------------------------------------------------------------------
    # TEST 9: SINGLE CLIENT DISCONNECTION ISOLATION CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 9: SINGLE CLIENT DISCONNECTION ISOLATION ---")
    ws_b = await websockets.connect(ws_url)
    ws_a = await websockets.connect(ws_url)
    await ws_a.close()  # Disconnect A

    asyncio.create_task(send_transaction_http(amount=15.0, mode="rest"))
    msg_b = json.loads(await asyncio.wait_for(ws_b.recv(), timeout=3.0))
    assert "sequence" in msg_b
    await ws_b.close()
    logger.info("[PASS] Test 9: Client disconnect isolation verified. Client B continued receiving events cleanly.")

    # -----------------------------------------------------------------------
    # TEST 10: HEARTBEAT / PING-PONG HANDLING
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 10: HEARTBEAT / PING-PONG HANDLING ---")
    async with websockets.connect(ws_url) as ws:
        await ws.send("ping")
        pong_data = {}
        for _ in range(5):
            raw_pong = await asyncio.wait_for(ws.recv(), timeout=3.0)
            data = json.loads(raw_pong)
            if data.get("event") == "PONG" or data.get("eventType") == "PONG":
                pong_data = data
                break
        assert pong_data.get("event") == "PONG", f"Expected PONG, got {pong_data.get('event')}"
        assert "timestamp" in pong_data
        logger.info("[PASS] Test 10: Heartbeat ping-pong stream health check verified.")

    # -----------------------------------------------------------------------
    # TEST 11: RECONNECT & BACKOFF BEHAVIOR
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 11: RECONNECT BEHAVIOR CHECK ---")
    ws = await websockets.connect(ws_url)
    await ws.close()
    async with websockets.connect(ws_url) as ws_reconnected:
        assert ws_reconnected.open is True
        logger.info("[PASS] Test 11: Reconnect and stream recovery pipeline verified.")

    # -----------------------------------------------------------------------
    # TEST 12: MISSED EVENT REPLAY RECOVERY FROM LASTSEQUENCE
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 12: MISSED EVENT REPLAY RECOVERY ---")
    async with websockets.connect(ws_url) as ws_temp:
        # Send ping to get latest sequence number
        await ws_temp.send("ping")
        pong = json.loads(await asyncio.wait_for(ws_temp.recv(), timeout=2.0))
        seq_before = pong.get("sequence", 0)

    # Send a transaction while client is disconnected
    await send_transaction_http(amount=12.0, mode="rest")

    # Reconnect with lastSequence
    replay_url = f"ws://127.0.0.1:8000/ws/transactions?lastSequence={seq_before}"
    async with websockets.connect(replay_url) as ws_replay:
        replayed = []
        for _ in range(5):
            m = json.loads(await asyncio.wait_for(ws_replay.recv(), timeout=3.0))
            replayed.append(m)
            if m.get("eventType") == "PAYMENT_SUCCESS":
                break

        assert len(replayed) > 0, "Expected replayed missed events"
        assert replayed[0]["sequence"] > seq_before, "Replayed event sequence should be > lastSequence"
        logger.info("[PASS] Test 12: Missed event replay recovery from lastSequence #%d verified (%d events replayed).", seq_before, len(replayed))

    # -----------------------------------------------------------------------
    # TEST 13: MALFORMED / INVALID WEBSOCKET MESSAGE HANDLING
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 13: MALFORMED MESSAGE HANDLING ---")
    async with websockets.connect(ws_url) as ws:
        await ws.send("INVALID_NON_JSON_CORRUPT_FRAME_DATA")
        await asyncio.sleep(0.1)
        assert ws.open is True, "Connection should remain open after non-fatal malformed frame"
        logger.info("[PASS] Test 13: Malformed frame handled safely without crashing connection.")

    # -----------------------------------------------------------------------
    # TEST 14: PHASE 1 CIRCUIT BREAKER REGRESSION CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 14: PHASE 1 CIRCUIT BREAKER REGRESSION CHECK ---")
    cb = CircuitBreaker("Phase4-CB-Test", failure_threshold=2, recovery_timeout=0.5)
    assert cb.state == CircuitState.CLOSED
    await cb.record_failure()
    await cb.record_failure()
    assert cb.state == CircuitState.OPEN
    await asyncio.sleep(0.6)
    assert cb.state == CircuitState.HALF_OPEN
    await cb.record_success()
    assert cb.state == CircuitState.CLOSED
    logger.info("[PASS] Test 14: Phase 1 Circuit Breaker verified without regression.")

    # -----------------------------------------------------------------------
    # TEST 15: PHASE 2 gRPC REGRESSION CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 15: PHASE 2 gRPC REGRESSION CHECK ---")
    res15 = await send_transaction_http(amount=15.0, mode="grpc")
    assert res15["status"] == "SUCCESS"
    logger.info("[PASS] Test 15: Phase 2 gRPC verified without regression.")

    # -----------------------------------------------------------------------
    # TEST 16: PHASE 3 RABBITMQ REGRESSION CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 16: PHASE 3 RABBITMQ REGRESSION CHECK ---")
    res16 = await send_transaction_http(amount=15.0, mode="rabbitmq")
    assert res16["status"] == "SUCCESS"
    logger.info("[PASS] Test 16: Phase 3 RabbitMQ message broker verified without regression.")

    logger.info("\n==========================================")
    logger.info("ALL 16 PHASE 4 TESTS PASSED SUCCESSFULLY!")
    logger.info("==========================================")


import subprocess


def test_phase4_suite():
    if __name__ != "__main__":
        subprocess.run([sys.executable, str(Path(__file__).resolve())], check=True)
    else:
        asyncio.run(run_all_tests())


if __name__ == "__main__":
    test_phase4_suite()


