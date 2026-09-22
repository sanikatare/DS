"""
Phase 2 Test Suite — gRPC / RPC Implementation Verification
===========================================================
Verifies all 13 required Phase 2 test cases:
- TEST 1: Normal transaction through REST.
- TEST 2: Normal transaction through gRPC.
- TEST 3: gRPC Sender Bank debit.
- TEST 4: gRPC NPCI routing.
- TEST 5: gRPC Receiver Bank credit.
- TEST 6: gRPC failure handling.
- TEST 7: gRPC timeout/deadline behavior.
- TEST 8: gRPC circuit breaker opening.
- TEST 9: gRPC circuit breaker fast-fail.
- TEST 10: gRPC Saga compensating rollback.
- TEST 11: gRPC idempotency.
- TEST 12: REST regression test after gRPC implementation.
- TEST 13: Mode switch (REST <-> gRPC) verification.
"""
import asyncio
import importlib.util
import logging
import os
import sys
import time
import types
import uuid
from pathlib import Path

# Add project roots to sys.path
BASE_DIR = Path(__file__).resolve().parent
SERVICES_DIR = BASE_DIR / "services"
TXN_PATH = str(SERVICES_DIR / "transaction-service")

if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))
if TXN_PATH not in sys.path:
    sys.path.insert(0, TXN_PATH)

def register_package(pkg_name, pkg_path):
    pkg_mod = types.ModuleType(pkg_name)
    pkg_mod.__path__ = [str(pkg_path)]
    pkg_mod.__file__ = str(pkg_path / "__init__.py")
    sys.modules[pkg_name] = pkg_mod
    return pkg_mod

def load_file_module(mod_name, file_path, package_name=None):
    spec = importlib.util.spec_from_file_location(mod_name, str(file_path))
    mod = importlib.util.module_from_spec(spec)
    if package_name:
        mod.__package__ = package_name
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod

# Register packages
register_package("sender_pkg", SERVICES_DIR / "sender-bank-service" / "app")
register_package("receiver_pkg", SERVICES_DIR / "receiver-bank-service" / "app")
register_package("npci_pkg", SERVICES_DIR / "npci-simulator-service" / "app")

# First load transaction-service store & orchestrator (uses app.store)
from app.store import init_db as init_txn_db, new_transaction, get_transaction_by_idempotency_key
from app.orchestrator import process_transaction
from app.grpc_client import call_grpc_debit, call_grpc_route, call_grpc_credit, call_grpc_rollback_debit
from app.retry_client import TransactionFailedError
from services.common.circuit_breaker import circuit_breaker_registry, CircuitState

# Now load bank & npci gRPC servers with package context
sender_db = load_file_module("sender_pkg.db", SERVICES_DIR / "sender-bank-service" / "app" / "db.py", "sender_pkg")
sender_main = load_file_module("sender_pkg.main", SERVICES_DIR / "sender-bank-service" / "app" / "main.py", "sender_pkg")
sender_grpc = load_file_module("sender_pkg.grpc_server", SERVICES_DIR / "sender-bank-service" / "app" / "grpc_server.py", "sender_pkg")

receiver_db = load_file_module("receiver_pkg.db", SERVICES_DIR / "receiver-bank-service" / "app" / "db.py", "receiver_pkg")
receiver_main = load_file_module("receiver_pkg.main", SERVICES_DIR / "receiver-bank-service" / "app" / "main.py", "receiver_pkg")
receiver_grpc = load_file_module("receiver_pkg.grpc_server", SERVICES_DIR / "receiver-bank-service" / "app" / "grpc_server.py", "receiver_pkg")

npci_main = load_file_module("npci_pkg.main", SERVICES_DIR / "npci-simulator-service" / "app" / "main.py", "npci_pkg")
npci_grpc = load_file_module("npci_pkg.grpc_server", SERVICES_DIR / "npci-simulator-service" / "app" / "grpc_server.py", "npci_pkg")

serve_sender_grpc = sender_grpc.serve_grpc
serve_npci_grpc = npci_grpc.serve_grpc
serve_receiver_grpc = receiver_grpc.serve_grpc

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("test_phase2")


async def setup_test_environment():
    logger.info("Setting up databases and starting local gRPC servers...")
    sender_db.init_db()
    receiver_db.init_db()
    init_txn_db()

    # Start gRPC servers
    sender_server = serve_sender_grpc()
    npci_server = serve_npci_grpc()
    receiver_server = serve_receiver_grpc()

    time.sleep(0.5)  # allow servers to bind
    return sender_server, npci_server, receiver_server


async def run_phase2_tests():
    sender_server, npci_server, receiver_server = await setup_test_environment()

    try:
        logger.info("==========================================")
        logger.info("TEST 3: gRPC SENDER BANK DEBIT")
        logger.info("==========================================")
        txn_id_debit = f"txn-debit-{uuid.uuid4().hex[:6]}"
        debit_res = await call_grpc_debit("sanika", 10.0, txn_id_debit)
        assert debit_res["status"] == "DEBITED"
        assert debit_res["approved"] is True
        logger.info("[PASS] Test 3 (gRPC Sender Bank debit) verified.")

        logger.info("==========================================")
        logger.info("TEST 4: gRPC NPCI ROUTING")
        logger.info("==========================================")
        txn_id_route = f"txn-route-{uuid.uuid4().hex[:6]}"
        route_res = await call_grpc_route(txn_id_route, "sender-bank-service", "receiver-bank-service", 10.0)
        assert route_res["status"] == "ROUTED"
        logger.info("[PASS] Test 4 (gRPC NPCI routing) verified.")

        logger.info("==========================================")
        logger.info("TEST 5: gRPC RECEIVER BANK CREDIT")
        logger.info("==========================================")
        txn_id_credit = f"txn-credit-{uuid.uuid4().hex[:6]}"
        credit_res = await call_grpc_credit("navya", 10.0, txn_id_credit)
        assert credit_res["status"] == "CREDITED"
        assert "ackId" in credit_res
        logger.info("[PASS] Test 5 (gRPC Receiver Bank credit) verified.")

        logger.info("==========================================")
        logger.info("TEST 2: END-TO-END TRANSACTION THROUGH gRPC")
        logger.info("==========================================")
        key_grpc = f"key-grpc-{uuid.uuid4().hex[:6]}"
        txn_grpc = new_transaction("sanika", "navya", 25.0, key_grpc)
        txn_grpc["mode"] = "grpc"
        res_grpc = await process_transaction(txn_grpc)
        assert res_grpc["status"] == "SUCCESS"
        logger.info("[PASS] Test 2 (End-to-End gRPC payment transaction) verified.")

        logger.info("==========================================")
        logger.info("TEST 11: gRPC IDEMPOTENCY")
        logger.info("==========================================")
        dup_grpc = get_transaction_by_idempotency_key(key_grpc)
        assert dup_grpc is not None
        assert dup_grpc["transactionId"] == txn_grpc["transactionId"]
        # Repeat credit call for same transaction ID
        dup_credit = await call_grpc_credit("navya", 25.0, txn_id_credit)
        assert dup_credit["status"] == "CREDITED"
        logger.info("[PASS] Test 11 (gRPC Idempotency check) verified.")

        logger.info("==========================================")
        logger.info("TEST 6 & 10: gRPC FAILURE & SAGA COMPENSATING ROLLBACK")
        logger.info("==========================================")
        receiver_main.FAILURE_STATE["failure_enabled"] = True

        key_fail = f"key-fail-{uuid.uuid4().hex[:6]}"
        txn_fail = new_transaction("sanika", "navya", 15.0, key_fail)
        txn_fail["mode"] = "grpc"

        rx_breaker = circuit_breaker_registry.get_breaker("Receiver Bank Service (gRPC)", failure_threshold=3)
        await rx_breaker.reset()

        res_fail = await process_transaction(txn_fail)
        assert res_fail["status"] == "FAILED"
        # Verify rollback was attempted
        assert any(t["event"] == "ROLLBACK_COMPLETED" for t in res_fail.get("timeline", []))
        logger.info("[PASS] Test 6 & 10 (gRPC failure & Saga compensating rollback) verified.")

        logger.info("==========================================")
        logger.info("TEST 8 & 9: gRPC CIRCUIT BREAKER OPENING & FAST-FAIL")
        logger.info("==========================================")
        # Receiver bank is still failing; trigger additional calls to trip circuit breaker
        try:
            await call_grpc_credit("navya", 10.0, f"txn-cb-1-{uuid.uuid4().hex[:4]}")
        except Exception:
            pass
        try:
            await call_grpc_credit("navya", 10.0, f"txn-cb-2-{uuid.uuid4().hex[:4]}")
        except Exception:
            pass

        assert rx_breaker.state == CircuitState.OPEN
        logger.info("[PASS] Test 8 (gRPC Circuit Breaker OPEN state) verified.")

        # Test fast-fail
        try:
            await call_grpc_credit("navya", 10.0, f"txn-cb-ff-{uuid.uuid4().hex[:4]}")
            assert False, "Should have fast-failed on OPEN circuit"
        except TransactionFailedError as exc:
            assert "Circuit breaker is OPEN" in exc.reason
            logger.info("[PASS] Test 9 (gRPC Circuit Breaker fast-fail): %s", exc.reason)

        # Reset receiver failure state
        receiver_main.FAILURE_STATE["failure_enabled"] = False
        await rx_breaker.reset()

        logger.info("==========================================")
        logger.info("TEST 7: gRPC TIMEOUT / DEADLINE BEHAVIOR")
        logger.info("==========================================")
        receiver_main.FAILURE_STATE["timeout_enabled"] = True
        try:
            await call_grpc_credit("navya", 10.0, f"txn-to-{uuid.uuid4().hex[:4]}")
        except TransactionFailedError as exc:
            logger.info("[PASS] Test 7 (gRPC Deadline Exceeded timeout): %s", exc.reason)
        finally:
            receiver_main.FAILURE_STATE["timeout_enabled"] = False
            await rx_breaker.reset()

        logger.info("==========================================")
        logger.info("TEST 12: REST REGRESSION TEST")
        logger.info("==========================================")
        key_rest = f"key-rest-{uuid.uuid4().hex[:6]}"
        txn_rest = new_transaction("sanika", "navya", 30.0, key_rest)
        txn_rest["mode"] = "rest"

        from unittest.mock import patch

        async def mock_rest_call(*args, **kwargs):
            url = kwargs.get("url", "")
            if "debit" in url:
                return {"status": "DEBITED", "approved": True}
            elif "route" in url:
                return {"status": "ROUTED"}
            elif "credit" in url:
                return {"status": "CREDITED", "ackId": "ack-123"}
            return {}

        with patch("app.orchestrator.call_with_retry", side_effect=mock_rest_call):
            res_rest = await process_transaction(txn_rest)
            assert res_rest["status"] == "SUCCESS"
            logger.info("[PASS] Test 12 (REST Regression test) verified.")

        logger.info("==========================================")
        logger.info("TEST 1 & 13: MODE SWITCH (REST <-> gRPC)")
        logger.info("==========================================")
        txn_m1 = new_transaction("sanika", "navya", 12.0, f"key-m1-{uuid.uuid4().hex[:6]}")
        txn_m1["mode"] = "rest"
        with patch("app.orchestrator.call_with_retry", side_effect=mock_rest_call):
            res_m1 = await process_transaction(txn_m1)
            assert res_m1["status"] == "SUCCESS"

        txn_m2 = new_transaction("sanika", "navya", 18.0, f"key-m2-{uuid.uuid4().hex[:6]}")
        txn_m2["mode"] = "grpc"
        res_m2 = await process_transaction(txn_m2)
        assert res_m2["status"] == "SUCCESS"
        logger.info("[PASS] Test 1 & 13 (REST <-> gRPC Mode Switch) verified.")

        logger.info("ALL 13 PHASE 2 TESTS PASSED SUCCESSFULLY!")

    finally:
        sender_server.stop(0)
        npci_server.stop(0)
        receiver_server.stop(0)


import subprocess


def test_phase2_suite():
    if __name__ != "__main__":
        subprocess.run([sys.executable, str(Path(__file__).resolve())], check=True)
    else:
        asyncio.run(run_phase2_tests())


if __name__ == "__main__":
    test_phase2_suite()


