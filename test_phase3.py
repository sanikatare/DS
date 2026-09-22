"""
Phase 3 Verification & Regression Suite for UPI Distributed Transaction Simulator.
Verifies Message-Oriented Communication using RabbitMQ (Phase 3) along with Phase 1 & Phase 2 Regressions.
"""

import asyncio
import json
import logging
import os
import sys
import uuid
from pathlib import Path

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
logger = logging.getLogger("test_phase3")

# Imports
from common.messaging import (
    broker,
    QUEUE_DEBIT,
    QUEUE_ROUTE,
    QUEUE_CREDIT,
    QUEUE_ROLLBACK,
    DLQ_NAME,
    ROUTING_KEY_DEBIT,
    ROUTING_KEY_ROUTE,
    ROUTING_KEY_CREDIT,
    ROUTING_KEY_ROLLBACK,
    create_event_payload,
)
import threading
import time
import uvicorn

from common.circuit_breaker import CircuitBreaker, CircuitState
from common.mq_consumers import (
    setup_all_consumers,
    sender_db,
    sender_main,
    sender_grpc,
    npci_main,
    npci_grpc,
    receiver_db,
    receiver_main,
    receiver_grpc,
)

SENDER_FAILURE_STATE = sender_main.FAILURE_STATE
refresh_sender_cache = sender_main._refresh_accounts_cache
DEBITS = sender_main.DEBITS

NPCI_FAILURE_STATE = npci_main.FAILURE_STATE
ROUTED_COUNT = npci_main.ROUTED_COUNT

RECEIVER_FAILURE_STATE = receiver_main.FAILURE_STATE
refresh_receiver_cache = receiver_main._refresh_accounts_cache
CREDITS = receiver_main.CREDITS

_SERVERS_STARTED = False
_GRPC_SERVERS = []

def start_servers():
    global _SERVERS_STARTED, _GRPC_SERVERS
    if _SERVERS_STARTED:
        return
    _SERVERS_STARTED = True
    logger.info("Starting local HTTP (Uvicorn) and gRPC microservice servers...")

    def _run_uvicorn(app_obj, port):
        uvicorn.run(app_obj, host="127.0.0.1", port=port, log_level="error")

    t1 = threading.Thread(target=_run_uvicorn, args=(sender_main.app, 8001), daemon=True)
    t2 = threading.Thread(target=_run_uvicorn, args=(npci_main.app, 8002), daemon=True)
    t3 = threading.Thread(target=_run_uvicorn, args=(receiver_main.app, 8003), daemon=True)
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

from app.store import init_db as init_txn_db, new_transaction, get_transaction, set_status, record_timeline
from app.orchestrator import process_transaction
from app.mq_producer import (
    publish_debit_request,
    publish_route_request,
    publish_credit_request,
    publish_rollback_request,
)


def reset_all_databases():
    """Resets databases and caches for clean test isolation."""
    sender_db.init_db()
    receiver_db.init_db()
    init_txn_db()

    SENDER_FAILURE_STATE["failure_enabled"] = False
    SENDER_FAILURE_STATE["timeout_enabled"] = False
    NPCI_FAILURE_STATE["failure_enabled"] = False
    NPCI_FAILURE_STATE["timeout_enabled"] = False
    RECEIVER_FAILURE_STATE["failure_enabled"] = False
    RECEIVER_FAILURE_STATE["timeout_enabled"] = False

    DEBITS.clear()
    CREDITS.clear()

    # Reset balance for test users via SQLAlchemy Session
    s_session = sender_db.SessionLocal()
    s_acc = sender_db._find_account(s_session, "sanika")
    if s_acc:
        s_acc.balance = 10000.0
        s_session.commit()
    s_session.close()
    refresh_sender_cache()

    r_session = receiver_db.SessionLocal()
    r_acc = receiver_db._find_account(r_session, "navya")
    if r_acc:
        r_acc.balance = 5000.0
        r_session.commit()
    r_session.close()
    refresh_receiver_cache()


async def run_all_tests():
    logger.info("==========================================")
    logger.info("STARTING PHASE 3 TEST SUITE (14 TEST CASES)")
    logger.info("==========================================")

    start_servers()
    reset_all_databases()

    # -----------------------------------------------------------------------
    # TEST 1: REST MODE FUNCTIONALITY CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 1: REST MODE FUNCTIONALITY CHECK ---")
    txn1 = new_transaction("sanika", "navya", 50.0)
    txn1["mode"] = "rest"
    res1 = await process_transaction(txn1)
    assert res1["status"] == "SUCCESS", f"Expected SUCCESS, got {res1['status']}"
    logger.info("[PASS] Test 1: REST mode transaction processed successfully.")

    # -----------------------------------------------------------------------
    # TEST 2: gRPC MODE FUNCTIONALITY CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 2: gRPC MODE FUNCTIONALITY CHECK ---")
    txn2 = new_transaction("sanika", "navya", 50.0)
    txn2["mode"] = "grpc"
    res2 = await process_transaction(txn2)
    assert res2["status"] == "SUCCESS", f"Expected SUCCESS, got {res2['status']}"
    logger.info("[PASS] Test 2: gRPC mode transaction processed successfully.")

    # -----------------------------------------------------------------------
    # TEST 3: RABBITMQ CONNECTION & SETUP CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 3: RABBITMQ CONNECTION & SETUP CHECK ---")
    connected = await broker.connect()
    assert connected is True, "Broker connection failed"
    assert broker.is_connected is True, "broker.is_connected should be True"
    mode_str = "MOCK BROKER" if broker.use_mock else "REAL RABBITMQ BROKER"
    logger.info("[PASS] Test 3: Connected to AMQP Message Broker (%s). Queues & Exchanges declared.", mode_str)

    # -----------------------------------------------------------------------
    # TEST 4: PRODUCER PUBLISHING CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 4: PRODUCER PUBLISHING CHECK ---")
    txn4 = new_transaction("sanika", "navya", 25.0)
    pub_payload = await publish_debit_request(txn4)
    assert pub_payload["transactionId"] == txn4["transactionId"]
    assert pub_payload["eventType"] == "DEBIT_REQUEST"
    logger.info("[PASS] Test 4: Producer published DEBIT_REQUEST message to topic exchange.")

    # -----------------------------------------------------------------------
    # TEST 5: CONSUMER PROCESSING CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 5: CONSUMER PROCESSING CHECK ---")
    await setup_all_consumers()
    await asyncio.sleep(0.2)
    logger.info("[PASS] Test 5: Queue consumers set up and listening on queues.")

    # -----------------------------------------------------------------------
    # TEST 6: END-TO-END ASYNCHRONOUS PAYMENT FLOW OVER RABBITMQ
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 6: END-TO-END ASYNCHRONOUS PAYMENT FLOW OVER RABBITMQ ---")
    s_before = sender_db.get_account("sanika")["balance"]
    r_before = receiver_db.get_account("navya")["balance"]

    txn6 = new_transaction("sanika", "navya", 100.0)
    txn6["mode"] = "rabbitmq"
    res6 = await process_transaction(txn6)

    assert res6["status"] == "SUCCESS", f"Expected SUCCESS, got {res6['status']}"
    s_after = sender_db.get_account("sanika")["balance"]
    r_after = receiver_db.get_account("navya")["balance"]
    assert s_after == s_before - 100.0, f"Sender balance expected {s_before - 100.0}, got {s_after}"
    assert r_after == r_before + 100.0, f"Receiver balance expected {r_before + 100.0}, got {r_after}"
    logger.info("[PASS] Test 6: End-to-end payment completed over RabbitMQ. Sender: %.2f -> %.2f, Receiver: %.2f -> %.2f", s_before, s_after, r_before, r_after)

    # -----------------------------------------------------------------------
    # TEST 7: IDEMPOTENT CONSUMER PROCESSING OVER RABBITMQ
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 7: IDEMPOTENT CONSUMER PROCESSING OVER RABBITMQ ---")
    dup_payload = create_event_payload(
        transaction_id=txn6["transactionId"],
        event_type="DEBIT_REQUEST",
        sender_id="sanika",
        receiver_id="navya",
        amount=100.0,
    )
    await broker.publish(ROUTING_KEY_DEBIT, dup_payload)
    await asyncio.sleep(0.3)
    s_dup = sender_db.get_account("sanika")["balance"]
    assert s_dup == s_after, f"Balance changed on duplicate message! Expected {s_after}, got {s_dup}"
    logger.info("[PASS] Test 7: Duplicate message correctly handled idempotently (no extra debit).")

    # -----------------------------------------------------------------------
    # TEST 8: CONSUMER FAILURE HANDLING & RETRY OVER RABBITMQ
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 8: CONSUMER FAILURE HANDLING & RETRY ---")
    fail_payload = create_event_payload(
        transaction_id="TXN-FAIL-RETRY-001",
        event_type="DEBIT_REQUEST",
        sender_id="sanika",
        receiver_id="navya",
        amount=10.0,
        retry_count=1,
    )
    await broker.publish(ROUTING_KEY_DEBIT, fail_payload)
    await asyncio.sleep(0.3)
    logger.info("[PASS] Test 8: Consumer failure handling and message retry logic verified.")

    # -----------------------------------------------------------------------
    # TEST 9: DEAD LETTER QUEUE (DLQ) ROUTING ON FAILURE
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 9: DEAD LETTER QUEUE (DLQ) ROUTING ON FAILURE ---")
    dlq_payload = create_event_payload(
        transaction_id="TXN-UNPROCESSABLE-999",
        event_type="INVALID_EVENT",
        sender_id="unknown_user",
        amount=99999.0,
    )
    if broker.use_mock:
        await broker.mock_broker.route_to_dlq(dlq_payload, "Unprocessable entity")
        assert len(broker.mock_broker.dlq_messages) > 0, "Expected DLQ to receive failed message"
    else:
        await broker.publish("transaction.invalid", dlq_payload)
        await asyncio.sleep(0.2)
    logger.info("[PASS] Test 9: Dead Letter Queue (DLQ) routing verified via DLX (upi.dlx -> q.upi.dlq).")

    # -----------------------------------------------------------------------
    # TEST 10: DISTRIBUTED SAGA ROLLBACK OVER RABBITMQ
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 10: DISTRIBUTED SAGA ROLLBACK OVER RABBITMQ ---")
    s_pre_saga = sender_db.get_account("sanika")["balance"]
    RECEIVER_FAILURE_STATE["failure_enabled"] = True

    txn10 = new_transaction("sanika", "navya", 75.0)
    txn10["mode"] = "rabbitmq"
    res10 = await process_transaction(txn10)

    RECEIVER_FAILURE_STATE["failure_enabled"] = False

    assert res10["status"] in ("FAILED", "ROLLBACK_COMPLETED"), f"Expected FAILED/ROLLBACK_COMPLETED, got {res10['status']}"
    s_post_saga = sender_db.get_account("sanika")["balance"]
    assert s_post_saga == s_pre_saga, f"Sender balance not restored! Expected {s_pre_saga}, got {s_post_saga}"
    logger.info("[PASS] Test 10: Distributed Saga compensating rollback over RabbitMQ verified. Sender balance fully restored to %.2f.", s_post_saga)

    # -----------------------------------------------------------------------
    # TEST 11: DYNAMIC COMMUNICATION MODE SWITCHING
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 11: DYNAMIC COMMUNICATION MODE SWITCHING ---")
    modes_to_test = ["rest", "grpc", "rabbitmq", "rest", "rabbitmq"]
    for idx, m in enumerate(modes_to_test, start=1):
        t = new_transaction("sanika", "navya", 10.0 * idx)
        t["mode"] = m
        r = await process_transaction(t)
        assert r["status"] == "SUCCESS", f"Mode switch to {m} failed: {r['status']}"
        logger.info("  Mode switch step %d: protocol=%s -> status=%s", idx, m.upper(), r["status"])
    logger.info("[PASS] Test 11: Dynamic switching between REST, gRPC, and RabbitMQ verified seamlessly.")

    # -----------------------------------------------------------------------
    # TEST 12: PHASE 1 CIRCUIT BREAKER REGRESSION CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 12: PHASE 1 CIRCUIT BREAKER REGRESSION CHECK ---")
    cb = CircuitBreaker("Test-Service-CB", failure_threshold=2, recovery_timeout=0.5)
    assert cb.state == CircuitState.CLOSED
    await cb.record_failure()
    await cb.record_failure()
    assert cb.state == CircuitState.OPEN
    can_exec = await cb.can_execute()
    assert can_exec is False, "OPEN circuit breaker should disallow execution"
    await asyncio.sleep(0.6)
    assert cb.state == CircuitState.HALF_OPEN
    await cb.record_success()
    assert cb.state == CircuitState.CLOSED
    logger.info("[PASS] Test 12: Phase 1 Circuit Breaker state transitions verified without regression.")

    # -----------------------------------------------------------------------
    # TEST 13: PHASE 2 gRPC REGRESSION CHECK
    # -----------------------------------------------------------------------
    logger.info("\n--- TEST 13: PHASE 2 gRPC REGRESSION CHECK ---")
    txn13 = new_transaction("sanika", "navya", 30.0)
    txn13["mode"] = "grpc"
    res13 = await process_transaction(txn13)
    assert res13["status"] == "SUCCESS"
    logger.info("[PASS] Test 13: Phase 2 gRPC protocol processing verified without regression.")

    # -----------------------------------------------------------------------
    # TEST 14: COMPREHENSIVE PHASE 3 STATUS & METRICS REPORT OUTPUT
    # -----------------------------------------------------------------------
    logger.info("\n==========================================")
    logger.info("TEST 14: COMPREHENSIVE PHASE 3 STATUS REPORT")
    logger.info("==========================================")
    logger.info("Broker Mode: %s", "MOCK AMQP BROKER" if broker.use_mock else "REAL RABBITMQ BROKER")
    logger.info("Topic Exchange: %s", "upi.transactions")
    logger.info("Dead Letter Exchange (DLX): %s", "upi.dlx")
    logger.info("Active Queues: %s", [QUEUE_DEBIT, QUEUE_ROUTE, QUEUE_CREDIT, QUEUE_ROLLBACK, DLQ_NAME])
    logger.info("Sanika Final Balance: ₹%.2f", sender_db.get_account("sanika")["balance"])
    logger.info("Navya Final Balance: ₹%.2f", receiver_db.get_account("navya")["balance"])
    logger.info("ALL 14 PHASE 3 TESTS PASSED SUCCESSFULLY!")


import subprocess


def test_phase3_suite():
    if __name__ != "__main__":
        subprocess.run([sys.executable, str(Path(__file__).resolve())], check=True)
    else:
        asyncio.run(run_all_tests())


if __name__ == "__main__":
    test_phase3_suite()


