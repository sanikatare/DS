"""
Transaction Service
--------------------
Entry-point / orchestrator service for the UPI Distributed Transaction
Simulator. Receives transaction requests from the frontend, drives the
Sender Bank -> NPCI -> Receiver Bank flow, streams live status over
WebSocket, and exposes fault-tolerance simulation controls plus
idempotency / duplicate-request handling.

Port: 8000
"""
import logging
import uuid
from datetime import datetime, timezone

from typing import Any
import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import FAILURE_TARGETS
from app.orchestrator import process_transaction
from app.store import (
    init_db,
    list_users,
    get_user_by_id_or_upi,
    get_transaction,
    get_transaction_by_idempotency_key,
    new_transaction,
    list_transactions,
    get_stats,
)
from app.ws_manager import manager
from app.webrtc_signaling import webrtc_manager

SERVICE_NAME = "transaction-service"
SERVICE_ROLE = "Transaction Orchestrator / Transaction Coordinator - receives requests and coordinates distributed banking workflow"
SERVICE_PORT = 8000

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(SERVICE_NAME)

app = FastAPI(
    title="UPI Simulator - Transaction Service",
    description="Educational simulation only. Not a real payment system.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from services.common.circuit_breaker import circuit_breaker_registry, CircuitState


async def _on_circuit_breaker_state_change(service: str, old_state: Any, new_state: Any, reason: str):
    await manager.broadcast({
        "event": "CIRCUIT_BREAKER_STATE_CHANGE",
        "service": service,
        "oldState": old_state.value if hasattr(old_state, "value") else str(old_state),
        "newState": new_state.value if hasattr(new_state, "value") else str(new_state),
        "reason": reason,
    })


@app.on_event("startup")
def on_startup():
    init_db()
    circuit_breaker_registry.set_on_state_change_callback(_on_circuit_breaker_state_change)
    logger.info("Transaction Service SQLite database & Circuit Breakers initialized.")



FAILURE_STATE = {
    "sender_bank_failure": False,
    "npci_failure": False,
    "receiver_bank_failure": False,
    "timeout_simulation": False,
}

FRIENDLY_TO_TARGET = {
    "sender-bank": "sender_bank_failure",
    "npci": "npci_failure",
    "receiver-bank": "receiver_bank_failure",
}


class InitiateRequest(BaseModel):
    senderId: str
    receiverId: str
    amount: float
    idempotencyKey: str | None = None
    mode: str | None = None


@app.get("/")
def root():
    return {
        "service": SERVICE_NAME,
        "role": SERVICE_ROLE,
        "port": SERVICE_PORT,
        "message": "UPI Distributed Transaction Simulator - educational project, not a real payment system.",
    }


@app.get("/health")
def health_check():
    return {
        "service": SERVICE_NAME,
        "status": "healthy",
        "port": SERVICE_PORT,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/users")
def get_users():
    return {"users": list_users()}


@app.get("/api/stats")
def get_transaction_stats():
    return get_stats()


# ---------------------------------------------------------------------------
# Transaction endpoints
# ---------------------------------------------------------------------------
@app.post("/api/transaction/initiate")
async def initiate_transaction(req: InitiateRequest):
    if req.senderId == req.receiverId:
        raise HTTPException(status_code=400, detail="Sender and receiver must be different accounts")
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    sender_user = get_user_by_id_or_upi(req.senderId)
    receiver_user = get_user_by_id_or_upi(req.receiverId)

    if sender_user and receiver_user:
        if sender_user["id"] == receiver_user["id"] or sender_user["upi_id"] == receiver_user["upi_id"]:
            raise HTTPException(status_code=400, detail="Sender and receiver must be different accounts")

    sender_upi = sender_user["upi_id"] if sender_user else req.senderId
    receiver_upi = receiver_user["upi_id"] if receiver_user else req.receiverId

    idempotency_key = req.idempotencyKey or f"auto-{uuid.uuid4().hex}"
    logger.info("Idempotency key received: %s", idempotency_key)

    # ---- Duplicate detection in SQLite ------------------------------------
    existing_txn = get_transaction_by_idempotency_key(idempotency_key)
    if existing_txn:
        logger.info(
            "Duplicate request detected for idempotency key %s - returning existing transaction %s (status=%s)",
            idempotency_key, existing_txn["transactionId"], existing_txn["status"],
        )
        await manager.broadcast({
            "event": "DUPLICATE_REQUEST_DETECTED",
            "transactionId": existing_txn["transactionId"],
            "idempotencyKey": idempotency_key,
            "status": existing_txn["status"],
        })
        return {
            **existing_txn,
            "duplicateRequest": True,
            "message": "Existing transaction returned. Duplicate processing prevented.",
        }

    # ---- New transaction --------------------------------------------------
    txn = new_transaction(sender_upi, receiver_upi, req.amount, idempotency_key)
    if req.mode:
        txn["mode"] = req.mode.lower()
    logger.info("[%s] New transaction created for idempotency key %s: %s -> %s, amount %s (mode=%s)",
                txn["transactionId"], idempotency_key, sender_upi, receiver_upi, req.amount, txn.get("mode", "default"))

    txn = await process_transaction(txn)
    return {**txn, "duplicateRequest": False}



@app.get("/api/transaction/{transaction_id}/status")
def get_transaction_status(transaction_id: str):
    txn = get_transaction(transaction_id)
    if txn is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return txn


@app.get("/api/transactions")
def get_transactions(status: str | None = Query(default=None)):
    return {"transactions": list_transactions(status_filter=status)}


# ---------------------------------------------------------------------------
# WebSocket - live transaction event stream (Phase 4 Stream-Oriented)
# ---------------------------------------------------------------------------
@app.websocket("/ws/transactions")
async def ws_transactions(
    websocket: WebSocket,
    lastSequence: int | None = Query(default=None),
    clientId: str | None = Query(default=None),
):
    await manager.connect(websocket, client_id=clientId)
    
    if lastSequence is not None and lastSequence > 0:
        await manager.replay_missed_events(websocket, lastSequence)

    try:
        while True:
            raw_msg = await websocket.receive_text()
            if not raw_msg:
                continue

            try:
                data = json.loads(raw_msg)
                if isinstance(data, str):
                    try:
                        data = json.loads(data)
                    except Exception:
                        data = {"action": data}
            except Exception:
                data = {"action": raw_msg.strip()}

            if not isinstance(data, dict):
                data = {"action": str(data)}

            action = str(data.get("action") or data.get("type") or data.get("event") or "").lower()

            if action in ("ping", "heartbeat"):
                await manager.handle_ping(websocket)
            elif action == "replay":
                req_seq = int(data.get("lastSequence", 0))
                await manager.replay_missed_events(websocket, req_seq)
            elif action == "stats":
                await websocket.send_json({"event": "STREAM_STATS", **manager.get_stream_stats()})
            else:
                logger.info("[WS] Received client control message: %s", data)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as exc:
        logger.warning("[WS] Client exception, closing connection: %s", exc)
        manager.disconnect(websocket)


@app.get("/api/websocket/stats")
def get_websocket_stats():
    return manager.get_stream_stats()


# ---------------------------------------------------------------------------
# WebRTC Signaling Endpoint (Phase 6 Peer-to-Peer DataChannel Signaling)
# ---------------------------------------------------------------------------
@app.websocket("/ws/webrtc")
async def ws_webrtc_signaling(
    websocket: WebSocket,
    roomId: str | None = Query(default=None),
    peerId: str | None = Query(default=None),
):
    import json
    await websocket.accept()
    current_room = roomId
    current_peer = peerId

    if current_room and current_peer:
        joined = await webrtc_manager.connect_peer(websocket, current_room, current_peer)
        if not joined:
            await websocket.send_json({"type": "error", "message": f"PeerId '{current_peer}' already taken in room '{current_room}'"})
            await websocket.close()
            return
        
        peers = webrtc_manager.get_room_peers(current_room)
        await websocket.send_json({"type": "joined", "roomId": current_room, "peerId": current_peer, "peers": peers})
        
        await webrtc_manager.route_signaling_message(websocket, {
            "type": "peer-joined",
            "roomId": current_room,
            "peerId": current_peer,
            "peers": peers,
        })
        
        await manager.broadcast({
            "event": "WEBRTC_PEER_JOINED",
            "roomId": current_room,
            "peerId": current_peer,
            "mode": "webrtc",
            "npciUsed": False,
        })

    try:
        while True:
            raw_text = await websocket.receive_text()
            if not raw_text:
                continue

            try:
                msg = json.loads(raw_text)
                if isinstance(msg, str):
                    try:
                        msg = json.loads(msg)
                    except Exception:
                        msg = {"type": msg}
            except Exception:
                logger.warning("[WebRTC WS] Received non-JSON message: %s", raw_text)
                await websocket.send_json({"type": "error", "message": "Invalid JSON signaling message"})
                continue

            if not isinstance(msg, dict):
                await websocket.send_json({"type": "error", "message": "Signaling message must be a JSON object"})
                continue

            msg_type = str(msg.get("type") or msg.get("action") or "").lower()

            if msg_type == "join":
                r_id = msg.get("roomId") or current_room
                p_id = msg.get("peerId") or current_peer
                if not r_id or not p_id:
                    await websocket.send_json({"type": "error", "message": "roomId and peerId are required for join"})
                    continue
                
                current_room, current_peer = r_id, p_id
                joined = await webrtc_manager.connect_peer(websocket, current_room, current_peer)
                if not joined:
                    await websocket.send_json({"type": "error", "message": f"PeerId '{current_peer}' already taken in room '{current_room}'"})
                    continue
                
                peers = webrtc_manager.get_room_peers(current_room)
                await websocket.send_json({"type": "joined", "roomId": current_room, "peerId": current_peer, "peers": peers})
                
                await webrtc_manager.route_signaling_message(websocket, {
                    "type": "peer-joined",
                    "roomId": current_room,
                    "peerId": current_peer,
                    "peers": peers,
                })
                await manager.broadcast({
                    "event": "WEBRTC_PEER_JOINED",
                    "roomId": current_room,
                    "peerId": current_peer,
                    "mode": "webrtc",
                    "npciUsed": False,
                })

            elif msg_type == "leave":
                await webrtc_manager.disconnect_socket(websocket)
                await websocket.send_json({"type": "left", "roomId": current_room, "peerId": current_peer})
                await manager.broadcast({
                    "event": "WEBRTC_PEER_DISCONNECTED",
                    "roomId": current_room,
                    "peerId": current_peer,
                    "mode": "webrtc",
                    "npciUsed": False,
                })

            elif msg_type in ("offer", "answer", "ice-candidate", "candidate"):
                await webrtc_manager.route_signaling_message(websocket, msg)
                
                evt_name = "WEBRTC_OFFER_CREATED" if msg_type == "offer" else "WEBRTC_ANSWER_CREATED" if msg_type == "answer" else "WEBRTC_ICE_CANDIDATE"
                await manager.broadcast({
                    "event": evt_name,
                    "roomId": current_room,
                    "peerId": current_peer,
                    "mode": "webrtc",
                    "npciUsed": False,
                })

            elif msg_type in ("ping", "heartbeat"):
                await websocket.send_json({"type": "pong", "timestamp": datetime.now(timezone.utc).isoformat()})
            else:
                logger.info("[WebRTC WS] Forwarding generic signaling payload type='%s'", msg_type)
                await webrtc_manager.route_signaling_message(websocket, msg)

    except WebSocketDisconnect:
        res = await webrtc_manager.disconnect_socket(websocket)
        if res:
            r_id, p_id = res
            await manager.broadcast({
                "event": "WEBRTC_PEER_DISCONNECTED",
                "roomId": r_id,
                "peerId": p_id,
                "mode": "webrtc",
                "npciUsed": False,
            })
    except Exception as exc:
        logger.warning("[WebRTC WS] Signaling socket exception: %s", exc)
        res = await webrtc_manager.disconnect_socket(websocket)
        if res:
            r_id, p_id = res
            await manager.broadcast({
                "event": "WEBRTC_PEER_DISCONNECTED",
                "roomId": r_id,
                "peerId": p_id,
                "mode": "webrtc",
                "npciUsed": False,
            })


@app.get("/api/webrtc/rooms")
def get_webrtc_rooms():
    return {"rooms": webrtc_manager.get_all_rooms()}


# ---------------------------------------------------------------------------
# Fault Tolerance Simulation Controls
# ---------------------------------------------------------------------------
async def _forward(url: str, path: str):
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.post(f"{url}{path}")
            resp.raise_for_status()
    except Exception as exc:
        logger.error("Failed to forward %s to %s: %s", path, url, exc)
        raise HTTPException(status_code=502, detail=f"Could not reach downstream service at {url}")


@app.post("/failure/timeout/enable")
async def enable_timeout():
    for url in FAILURE_TARGETS.values():
        await _forward(url, "/failure/timeout/enable")
    FAILURE_STATE["timeout_simulation"] = True
    logger.warning("Timeout simulation ENABLED (all downstream services)")
    return dict(FAILURE_STATE)


@app.post("/failure/timeout/disable")
async def disable_timeout():
    for url in FAILURE_TARGETS.values():
        await _forward(url, "/failure/timeout/disable")
    FAILURE_STATE["timeout_simulation"] = False
    logger.info("Timeout simulation DISABLED (all downstream services)")
    return dict(FAILURE_STATE)


@app.post("/failure/{target}/enable")
async def enable_failure(target: str):
    if target not in FAILURE_TARGETS:
        raise HTTPException(status_code=404, detail=f"Unknown failure target: {target}")
    await _forward(FAILURE_TARGETS[target], "/failure/enable")
    FAILURE_STATE[FRIENDLY_TO_TARGET[target]] = True
    logger.warning("Failure simulation ENABLED for %s", target)
    return dict(FAILURE_STATE)


@app.post("/failure/{target}/disable")
async def disable_failure(target: str):
    if target not in FAILURE_TARGETS:
        raise HTTPException(status_code=404, detail=f"Unknown failure target: {target}")
    await _forward(FAILURE_TARGETS[target], "/failure/disable")
    FAILURE_STATE[FRIENDLY_TO_TARGET[target]] = False
    logger.info("Failure simulation DISABLED for %s", target)
    return dict(FAILURE_STATE)


@app.get("/failure/status")
def failure_status():
    return {
        **FAILURE_STATE,
        "circuit_breakers": circuit_breaker_registry.get_all_statuses(),
    }


@app.get("/api/circuit-breaker/status")
def get_circuit_breaker_status():
    return {"circuitBreakers": circuit_breaker_registry.get_all_statuses()}


@app.post("/api/circuit-breaker/reset")
async def reset_circuit_breakers():
    await circuit_breaker_registry.reset_all()
    return {"status": "RESET", "circuitBreakers": circuit_breaker_registry.get_all_statuses()}


@app.get("/api/dashboard/stats")
def get_dashboard_unified_stats():
    txn_stats = get_stats()
    cb_statuses = circuit_breaker_registry.get_all_statuses()
    ws_stats = manager.get_stream_stats()
    webrtc_rooms = webrtc_manager.get_all_rooms()

    protocols = [
        {
            "id": "rest",
            "name": "REST / HTTP/1.1",
            "phase": "Phase 0 & 1",
            "type": "Synchronous Request-Response",
            "transport": "HTTP/1.1 JSON over TCP",
            "routing": "Central Hub Orchestrator",
            "npciBypassed": False,
            "status": "Active",
            "description": "Standard UPI central hub flow with 3-state Circuit Breaker & retries.",
        },
        {
            "id": "grpc",
            "name": "gRPC / HTTP/2",
            "phase": "Phase 2",
            "type": "Synchronous Binary RPC",
            "transport": "HTTP/2 Protocol Buffers (upi.proto)",
            "routing": "Central Hub Orchestrator",
            "npciBypassed": False,
            "status": "Active",
            "description": "High-efficiency strongly-typed binary remote procedure calls.",
        },
        {
            "id": "rabbitmq",
            "name": "RabbitMQ AMQP",
            "phase": "Phase 3",
            "type": "Asynchronous Message-Oriented Broker",
            "transport": "AMQP 0-9-1 Topic Exchange & DLX",
            "routing": "Queue Consumers (q.sender.debit, q.npci, etc.)",
            "npciBypassed": False,
            "status": "Active",
            "description": "Decoupled queue worker processing with Dead Letter Exchange resilience.",
        },
        {
            "id": "websocket",
            "name": "WebSocket Push",
            "phase": "Phase 4",
            "type": "Stream-Oriented Real-Time Push",
            "transport": "Persistent WebSocket TCP Stream",
            "routing": "Broadcast Stream Manager (Ring Buffer: 500)",
            "npciBypassed": False,
            "status": "Active",
            "description": "Low-latency event streaming with sequence numbering & recovery replay.",
        },
        {
            "id": "p2p",
            "name": "Direct P2P HTTP",
            "phase": "Phase 5",
            "type": "Direct Peer Messaging",
            "transport": "HTTP REST (Sender Bank -> Receiver Bank)",
            "routing": "Direct Inter-Bank Connection",
            "npciBypassed": True,
            "status": "Active",
            "description": "Direct bank-to-bank credit transfer completely bypassing NPCI Switch.",
        },
        {
            "id": "webrtc",
            "name": "WebRTC RTCDataChannel",
            "phase": "Phase 6",
            "type": "Browser Peer-to-Peer DataChannel",
            "transport": "SCTP over DTLS/UDP (STUN Traversal)",
            "routing": "Direct Browser-to-Browser (Backend Signaling Only)",
            "npciBypassed": True,
            "status": "Active",
            "description": "Browser-to-browser P2P DataChannel payload exchange with zero backend data routing.",
        },
    ]

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "transactionStats": txn_stats,
        "circuitBreakers": cb_statuses,
        "websocketStream": ws_stats,
        "webrtcRooms": webrtc_rooms,
        "failureState": FAILURE_STATE,
        "protocols": protocols,
    }

