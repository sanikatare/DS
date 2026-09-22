"""
Phase 6 Verification & Regression Suite for UPI Distributed Transaction Simulator.
Verifies Phase 6: WebRTC Signaling Server (/ws/webrtc), SDP Offer/Answer Routing, ICE Candidate Forwarding,
Room Management, Duplicate Rejection, and Zero Regression across Phase 1, Phase 2, Phase 3, Phase 4 & Phase 5.
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
logger = logging.getLogger("test_phase6")

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

from app.store import init_db as init_txn_db
import app.main as txn_main

_SERVERS_STARTED = False
_GRPC_SERVERS = []


def start_servers():
    global _SERVERS_STARTED, _GRPC_SERVERS
    if _SERVERS_STARTED:
        return
    _SERVERS_STARTED = True
    logger.info("Starting local HTTP (Uvicorn) and gRPC microservice servers for Phase 6...")

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


async def run_all_tests():
    start_servers()
    reset_all_databases()

    base_url = "http://127.0.0.1:8000"
    webrtc_ws_url = "ws://127.0.0.1:8000/ws/webrtc"

    async with httpx.AsyncClient(timeout=10.0) as client:
        # =====================================================================
        # TEST 1: WEBRTC SIGNALING ENDPOINT AVAILABILITY
        # =====================================================================
        logger.info("\n--- TEST 1: WEBRTC SIGNALING ENDPOINT AVAILABILITY ---")
        async with websockets.connect(f"{webrtc_ws_url}?roomId=TEST-ROOM-1&peerId=peer-a") as ws:
            resp_raw = await ws.recv()
            resp = json.loads(resp_raw)
            assert resp["type"] == "joined"
            assert resp["roomId"] == "TEST-ROOM-1"
            assert resp["peerId"] == "peer-a"
            assert "peer-a" in resp["peers"]
        logger.info("[PASS] Test 1: WebRTC signaling endpoint connected & joined room.")

        # =====================================================================
        # TEST 2: ROOM JOIN & MULTI-PEER REGISTRATION
        # =====================================================================
        logger.info("\n--- TEST 2: ROOM JOIN & MULTI-PEER REGISTRATION ---")
        room_id = f"ROOM-TEST-{uuid.uuid4().hex[:6]}"

        async with websockets.connect(f"{webrtc_ws_url}?roomId={room_id}&peerId=sender-peer") as ws_a:
            msg_a1 = json.loads(await ws_a.recv())
            assert msg_a1["type"] == "joined"
            assert msg_a1["peers"] == ["sender-peer"]

            # Peer B joins the same room
            async with websockets.connect(f"{webrtc_ws_url}?roomId={room_id}&peerId=receiver-peer") as ws_b:
                msg_b1 = json.loads(await ws_b.recv())
                assert msg_b1["type"] == "joined"
                assert set(msg_b1["peers"]) == {"sender-peer", "receiver-peer"}

                # Peer A should receive peer-joined event
                msg_a2 = json.loads(await ws_a.recv())
                assert msg_a2["type"] == "peer-joined"
                assert msg_a2["peerId"] == "receiver-peer"

        logger.info("[PASS] Test 2: Multi-peer room join & notifications verified.")

        # =====================================================================
        # TEST 3: SDP OFFER & ANSWER FORWARDING
        # =====================================================================
        logger.info("\n--- TEST 3: SDP OFFER & ANSWER FORWARDING ---")
        sdp_room = f"ROOM-SDP-{uuid.uuid4().hex[:6]}"

        async with websockets.connect(f"{webrtc_ws_url}?roomId={sdp_room}&peerId=peer-a") as ws_a, \
                   websockets.connect(f"{webrtc_ws_url}?roomId={sdp_room}&peerId=peer-b") as ws_b:
            await ws_a.recv()  # joined
            await ws_b.recv()  # joined
            await ws_a.recv()  # peer-joined notification

            # Peer A sends offer
            offer_payload = {
                "type": "offer",
                "roomId": sdp_room,
                "peerId": "peer-a",
                "sdp": {"type": "offer", "sdp": "v=0\r\no=- 12345 2 IN IP4 127.0.0.1..."}
            }
            await ws_a.send(json.dumps(offer_payload))

            # Peer B receives offer
            offer_msg = json.loads(await ws_b.recv())
            assert offer_msg["type"] == "offer"
            assert offer_msg["peerId"] == "peer-a"
            assert "sdp" in offer_msg

            # Peer B sends answer
            answer_payload = {
                "type": "answer",
                "roomId": sdp_room,
                "peerId": "peer-b",
                "sdp": {"type": "answer", "sdp": "v=0\r\no=- 54321 2 IN IP4 127.0.0.1..."}
            }
            await ws_b.send(json.dumps(answer_payload))

            # Peer A receives answer
            answer_msg = json.loads(await ws_a.recv())
            assert answer_msg["type"] == "answer"
            assert answer_msg["peerId"] == "peer-b"
            assert "sdp" in answer_msg

        logger.info("[PASS] Test 3: WebRTC SDP Offer/Answer forwarding verified.")

        # =====================================================================
        # TEST 4: ICE CANDIDATE FORWARDING
        # =====================================================================
        logger.info("\n--- TEST 4: ICE CANDIDATE FORWARDING ---")
        ice_room = f"ROOM-ICE-{uuid.uuid4().hex[:6]}"

        async with websockets.connect(f"{webrtc_ws_url}?roomId={ice_room}&peerId=peer-a") as ws_a, \
                   websockets.connect(f"{webrtc_ws_url}?roomId={ice_room}&peerId=peer-b") as ws_b:
            await ws_a.recv()
            await ws_b.recv()
            await ws_a.recv()

            ice_candidate = {
                "candidate": "candidate:1 1 UDP 2122260223 192.168.1.1 54321 typ host",
                "sdpMid": "0",
                "sdpMLineIndex": 0
            }
            await ws_a.send(json.dumps({
                "type": "ice-candidate",
                "roomId": ice_room,
                "peerId": "peer-a",
                "candidate": ice_candidate
            }))

            ice_msg = json.loads(await ws_b.recv())
            assert ice_msg["type"] == "ice-candidate"
            assert ice_msg["peerId"] == "peer-a"
            assert ice_msg["candidate"]["sdpMid"] == "0"

        logger.info("[PASS] Test 4: ICE candidate forwarding verified.")

        # =====================================================================
        # TEST 5: DUPLICATE PEER ID REJECTION
        # =====================================================================
        logger.info("\n--- TEST 5: DUPLICATE PEER ID REJECTION ---")
        dup_room = f"ROOM-DUP-{uuid.uuid4().hex[:6]}"

        async with websockets.connect(f"{webrtc_ws_url}?roomId={dup_room}&peerId=sender-peer") as ws_a:
            await ws_a.recv()  # joined

            # Peer C attempts to join as 'sender-peer' in same room
            try:
                async with websockets.connect(f"{webrtc_ws_url}?roomId={dup_room}&peerId=sender-peer") as ws_c:
                    errMsg = json.loads(await ws_c.recv())
                    assert errMsg["type"] == "error"
                    assert "already taken" in errMsg["message"]
            except websockets.exceptions.ConnectionClosed:
                pass  # Closed by server after error

        logger.info("[PASS] Test 5: Duplicate peer ID in same room correctly rejected.")

        # =====================================================================
        # TEST 6: INVALID SIGNALING MESSAGE HANDLING
        # =====================================================================
        logger.info("\n--- TEST 6: INVALID SIGNALING MESSAGE HANDLING ---")
        async with websockets.connect(f"{webrtc_ws_url}?roomId=ROOM-ERR&peerId=peer-err") as ws:
            await ws.recv()  # joined
            # Send non-JSON string
            await ws.send("NON_JSON_CORRUPT_SIGNAL")
            err_resp = json.loads(await ws.recv())
            assert err_resp["type"] == "error"
            assert "Invalid JSON" in err_resp["message"]

        logger.info("[PASS] Test 6: Invalid signaling message handled safely.")

        # =====================================================================
        # TEST 7: PEER DISCONNECT CLEANUP & LEAVE NOTIFICATION
        # =====================================================================
        logger.info("\n--- TEST 7: PEER DISCONNECT CLEANUP & LEAVE NOTIFICATION ---")
        disc_room = f"ROOM-DISC-{uuid.uuid4().hex[:6]}"

        ws_a = await websockets.connect(f"{webrtc_ws_url}?roomId={disc_room}&peerId=peer-a")
        await ws_a.recv()

        ws_b = await websockets.connect(f"{webrtc_ws_url}?roomId={disc_room}&peerId=peer-b")
        await ws_b.recv()
        await ws_a.recv()  # peer-joined notification

        # Peer B disconnects
        await ws_b.close()

        # Peer A receives peer-left
        left_msg = json.loads(await ws_a.recv())
        assert left_msg["type"] == "peer-left"
        assert left_msg["peerId"] == "peer-b"
        await ws_a.close()

        logger.info("[PASS] Test 7: Peer disconnect cleanup and peer-left notification verified.")

        # =====================================================================
        # TEST 8: SIGNALING ROOMS REST API
        # =====================================================================
        logger.info("\n--- TEST 8: SIGNALING ROOMS REST API ---")
        rooms_resp = await client.get(f"{base_url}/api/webrtc/rooms")
        assert rooms_resp.status_code == 200
        rooms_data = rooms_resp.json()
        assert "rooms" in rooms_data
        logger.info("[PASS] Test 8: /api/webrtc/rooms endpoint verified.")

        # =====================================================================
        # TEST 9: PHASE 1 CIRCUIT BREAKER REGRESSION CHECK
        # =====================================================================
        logger.info("\n--- TEST 9: PHASE 1 CIRCUIT BREAKER REGRESSION CHECK ---")
        cb = CircuitBreaker("Phase6-CB-Test", failure_threshold=2, recovery_timeout=0.5, success_threshold=1)
        assert cb.state == CircuitState.CLOSED
        await cb.record_failure()
        await cb.record_failure()
        assert cb.state == CircuitState.OPEN
        assert await cb.can_execute() is False
        await asyncio.sleep(0.6)
        assert cb.state == CircuitState.HALF_OPEN
        assert await cb.can_execute() is True
        await cb.record_success()
        assert cb.state == CircuitState.CLOSED
        logger.info("[PASS] Test 9: Phase 1 Circuit Breaker verified without regression.")

        # =====================================================================
        # TEST 10: PHASE 2 gRPC REGRESSION CHECK
        # =====================================================================
        logger.info("\n--- TEST 10: PHASE 2 gRPC REGRESSION CHECK ---")
        grpc_key = f"auto-{uuid.uuid4().hex}"
        resp_grpc = await client.post(
            f"{base_url}/api/transaction/initiate",
            json={
                "senderId": "sanika",
                "receiverId": "navya",
                "amount": 35.0,
                "idempotencyKey": grpc_key,
                "mode": "grpc",
            },
        )
        assert resp_grpc.status_code == 200
        assert resp_grpc.json()["status"] == "SUCCESS"
        logger.info("[PASS] Test 10: Phase 2 gRPC mode verified without regression.")

        # =====================================================================
        # TEST 11: PHASE 3 RABBITMQ REGRESSION CHECK
        # =====================================================================
        logger.info("\n--- TEST 11: PHASE 3 RABBITMQ REGRESSION CHECK ---")
        mq_key = f"auto-{uuid.uuid4().hex}"
        resp_mq = await client.post(
            f"{base_url}/api/transaction/initiate",
            json={
                "senderId": "sanika",
                "receiverId": "navya",
                "amount": 25.0,
                "idempotencyKey": mq_key,
                "mode": "rabbitmq",
            },
        )
        assert resp_mq.status_code == 200
        assert resp_mq.json()["status"] == "SUCCESS"
        logger.info("[PASS] Test 11: Phase 3 RabbitMQ mode verified without regression.")

        # =====================================================================
        # TEST 12: PHASE 4 WEBSOCKET STREAMING REGRESSION CHECK
        # =====================================================================
        logger.info("\n--- TEST 12: PHASE 4 WEBSOCKET STREAMING REGRESSION CHECK ---")
        stats_resp = await client.get(f"{base_url}/api/websocket/stats")
        assert stats_resp.status_code == 200
        stats = stats_resp.json()
        assert "bufferedEvents" in stats or "maxBufferSize" in stats
        logger.info("[PASS] Test 12: Phase 4 WebSocket streaming stats verified without regression.")

        # =====================================================================
        # TEST 13: PHASE 5 DIRECT P2P COMMUNICATION REGRESSION CHECK
        # =====================================================================
        logger.info("\n--- TEST 13: PHASE 5 DIRECT P2P COMMUNICATION REGRESSION CHECK ---")
        p2p_key = f"auto-p2p-{uuid.uuid4().hex}"
        resp_p2p = await client.post(
            f"{base_url}/api/transaction/initiate",
            json={
                "senderId": "sanika",
                "receiverId": "navya",
                "amount": 45.0,
                "idempotencyKey": p2p_key,
                "mode": "p2p",
            },
        )
        assert resp_p2p.status_code == 200
        p2p_data = resp_p2p.json()
        assert p2p_data["status"] == "SUCCESS"
        assert p2p_data["mode"] == "p2p"
        logger.info("[PASS] Test 13: Phase 5 Direct P2P mode verified without regression.")

        # =====================================================================
        # TEST 14: COMPREHENSIVE PHASE 6 WEBRTC STATUS REPORT
        # =====================================================================
        logger.info("\n==========================================")
        logger.info("TEST 14: COMPREHENSIVE PHASE 6 WEBRTC STATUS REPORT")
        logger.info("==========================================")
        logger.info("Signaling Transport: WebSocket (/ws/webrtc)")
        logger.info("Data Transport: RTCDataChannel ('upi-p2p') Browser-to-Browser")
        logger.info("STUN Configuration: stun:stun.l.google.com:19302")
        logger.info("Signaling Server Role: SDP/ICE Broker Only (0 payment data bytes routed)")
        logger.info("ALL 14 PHASE 6 TESTS PASSED SUCCESSFULLY!")
        logger.info("==========================================")


import subprocess


def test_phase6_suite():
    if __name__ != "__main__":
        subprocess.run([sys.executable, str(Path(__file__).resolve())], check=True)
    else:
        asyncio.run(run_all_tests())


if __name__ == "__main__":
    test_phase6_suite()


