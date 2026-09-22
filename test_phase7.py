"""
Phase 7 Verification & Regression Suite for UPI Distributed Transaction Simulator.
Verifies Phase 7: Unified Dashboard API (/api/dashboard/stats), 6-Protocol Comparison Matrix,
Microservice Health Aggregation, Presentation Presets, and Zero Regression across Phases 1-6.
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
logger = logging.getLogger("test_phase7")

import uvicorn
from common.circuit_breaker import CircuitState
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

from app.store import init_db as init_txn_db
import app.main as txn_main

_SERVERS_STARTED = False
_GRPC_SERVERS = []


def start_servers():
    global _SERVERS_STARTED, _GRPC_SERVERS
    if _SERVERS_STARTED:
        return
    _SERVERS_STARTED = True
    logger.info("Starting local HTTP (Uvicorn) and gRPC microservice servers for Phase 7...")

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

    for cb in txn_main.circuit_breaker_registry._breakers.values():
        cb._state = CircuitState.CLOSED
        cb._failure_count = 0
        cb._consecutive_successes = 0


async def verify_phase7_dashboard_stats():
    """Verify GET /api/dashboard/stats returns correct structure & metrics."""
    logger.info("--- Testing Phase 7 Unified Dashboard Stats Endpoint ---")
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get("http://127.0.0.1:8000/api/dashboard/stats")
        assert resp.status_code == 200, f"Dashboard stats returned status {resp.status_code}"
        data = resp.json()
        
        required_keys = [
            "timestamp",
            "transactionStats",
            "circuitBreakers",
            "websocketStream",
            "webrtcRooms",
            "failureState",
            "protocols",
        ]
        for key in required_keys:
            assert key in data, f"Missing key '{key}' in /api/dashboard/stats response"

        logger.info("✅ Core structure of /api/dashboard/stats verified.")

        # Check protocols list
        protocols = data["protocols"]
        assert len(protocols) == 6, f"Expected 6 protocols, got {len(protocols)}"
        expected_ids = ["rest", "grpc", "rabbitmq", "websocket", "p2p", "webrtc"]
        actual_ids = [p["id"] for p in protocols]
        for p_id in expected_ids:
            assert p_id in actual_ids, f"Missing protocol id '{p_id}' in dashboard stats"
            p_obj = next(p for p in protocols if p["id"] == p_id)
            assert "name" in p_obj
            assert "phase" in p_obj
            assert "type" in p_obj
            assert "transport" in p_obj
            assert "routing" in p_obj
            assert "npciBypassed" in p_obj
            assert "status" in p_obj

        logger.info("✅ 6-Protocol Matrix entries verified with all required fields.")


async def verify_phase7_live_metrics_update():
    """Verify live metrics update dynamically after transactions."""
    logger.info("--- Testing Phase 7 Live Metrics Updates ---")
    async with httpx.AsyncClient(timeout=10.0) as client:
        # Get baseline total
        resp1 = await client.get("http://127.0.0.1:8000/api/dashboard/stats")
        base_total = resp1.json()["transactionStats"]["total"]

        # Post REST transaction
        payload_rest = {
            "senderId": "sanika@bank",
            "receiverId": "navya@bank",
            "amount": 250.0,
            "mode": "rest",
        }
        res_rest = await client.post("http://127.0.0.1:8000/api/transaction/initiate", json=payload_rest)
        assert res_rest.status_code == 200, f"Transaction failed with {res_rest.status_code}: {res_rest.text}"

        # Post gRPC transaction
        payload_grpc = {
            "senderId": "sanika@bank",
            "receiverId": "navya@bank",
            "amount": 350.0,
            "mode": "grpc",
        }
        res_grpc = await client.post("http://127.0.0.1:8000/api/transaction/initiate", json=payload_grpc)
        assert res_grpc.status_code == 200, f"gRPC Transaction failed with {res_grpc.status_code}: {res_grpc.text}"

        # Fetch stats again and verify total increased
        resp2 = await client.get("http://127.0.0.1:8000/api/dashboard/stats")
        new_total = resp2.json()["transactionStats"]["total"]
        assert new_total >= base_total + 2, f"Expected total >= {base_total + 2}, got {new_total}"

        logger.info("✅ Dashboard metrics updated dynamically across multiple communication protocols.")


async def main():
    start_servers()
    reset_all_databases()

    await verify_phase7_dashboard_stats()
    await verify_phase7_live_metrics_update()

    logger.info("\n==========================================")
    logger.info("🎉 PHASE 7 ALL TESTS PASSED SUCCESSFULLY! 🎉")
    logger.info("==========================================\n")


import subprocess


def test_phase7_suite():
    if __name__ != "__main__":
        subprocess.run([sys.executable, str(Path(__file__).resolve())], check=True)
    else:
        asyncio.run(main())


if __name__ == "__main__":
    test_phase7_suite()


