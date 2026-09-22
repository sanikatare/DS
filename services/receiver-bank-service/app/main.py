"""
Receiver Bank Service
-----------------------
Simulates the receiver's bank. Validates the receiver account and
handles credit + acknowledgement for a transaction. Also supports
controllable failure simulation for the fault-tolerance demo.

Port: 8003
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import db as account_db

SERVICE_NAME = "receiver-bank-service"
SERVICE_ROLE = "Validates receiver account and handles credit + acknowledgement"
SERVICE_PORT = 8003

TIMEOUT_SIMULATION_DELAY_SECONDS = 5

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(SERVICE_NAME)

app = FastAPI(
    title="UPI Simulator - Receiver Bank Service",
    description="Educational simulation only. Not a real payment system.",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Account balances and credit records persisted in SQLite (see app/db.py).
ACCOUNTS: dict[str, dict] = {}

# transactionId -> ackId — in-memory cache mirrored in SQLite credits table.
CREDITS: dict[str, str] = {}

FAILURE_STATE = {
    "failure_enabled": False,
    "timeout_enabled": False,
}


class CreditRequest(BaseModel):
    receiverId: str
    amount: float
    transactionId: str


class PeerCreditRequest(BaseModel):
    transactionId: str
    senderId: str
    receiverId: str
    amount: float
    senderBank: str = "sender-bank-service"
    receiverBank: str = "receiver-bank-service"


def _refresh_accounts_cache():
    """Reload ACCOUNTS from SQLite after a balance change."""
    global ACCOUNTS
    ACCOUNTS = account_db.list_accounts()


from .grpc_server import serve_grpc


@app.on_event("startup")
def on_startup():
    """Initialize SQLite database and seed accounts on first run, start gRPC server."""
    account_db.init_db()
    _refresh_accounts_cache()
    try:
        serve_grpc()
    except Exception as exc:
        logger.warning("Could not start Receiver Bank gRPC server: %s", exc)
    logger.info("SQLite database initialized at %s", account_db.DB_PATH)



def _simulate_failure_if_enabled():
    if FAILURE_STATE["failure_enabled"]:
        logger.warning("Simulated failure is ON - rejecting request")
        raise HTTPException(status_code=503, detail=f"{SERVICE_NAME} simulated failure")


async def _simulate_timeout_if_enabled():
    if FAILURE_STATE["timeout_enabled"]:
        logger.warning(
            "Timeout simulation is ON - delaying response by %ss",
            TIMEOUT_SIMULATION_DELAY_SECONDS,
        )
        await asyncio.sleep(TIMEOUT_SIMULATION_DELAY_SECONDS)


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


@app.get("/bank/accounts")
def list_accounts():
    return {"accounts": [{"id": k, **v} for k, v in ACCOUNTS.items()]}


@app.post("/bank/credit")
async def credit(req: CreditRequest):
    _simulate_failure_if_enabled()
    await _simulate_timeout_if_enabled()

    if req.transactionId in CREDITS:
        logger.info("[%s] Credit already applied, returning existing ack", req.transactionId)
        return {"status": "CREDITED", "ackId": CREDITS[req.transactionId]}

    existing_ack = account_db.get_credit_ack(req.transactionId)
    if existing_ack:
        CREDITS[req.transactionId] = existing_ack
        logger.info("[%s] Credit already applied (from DB), returning existing ack", req.transactionId)
        return {"status": "CREDITED", "ackId": existing_ack}

    account = account_db.get_account(req.receiverId)
    if account is None:
        raise HTTPException(status_code=404, detail=f"Unknown receiver account: {req.receiverId}")

    ack_id = str(uuid.uuid4())
    account_db.apply_credit(req.transactionId, req.receiverId, req.amount, ack_id)
    CREDITS[req.transactionId] = ack_id
    _refresh_accounts_cache()
    logger.info("[%s] Credited %s to %s", req.transactionId, req.amount, req.receiverId)
    return {"status": "CREDITED", "ackId": ack_id}


@app.post("/peer/credit")
async def peer_credit(req: PeerCreditRequest):
    _simulate_failure_if_enabled()
    await _simulate_timeout_if_enabled()

    if req.transactionId in CREDITS:
        logger.info("[%s] Direct P2P credit already applied, returning existing ack", req.transactionId)
        return {
            "status": "CREDITED",
            "ackId": CREDITS[req.transactionId],
            "mode": "p2p",
            "npciUsed": False,
            "sourcePeer": req.senderBank,
            "destinationPeer": req.receiverBank,
        }

    existing_ack = account_db.get_credit_ack(req.transactionId)
    if existing_ack:
        CREDITS[req.transactionId] = existing_ack
        logger.info("[%s] Direct P2P credit already applied (from DB), returning existing ack", req.transactionId)
        return {
            "status": "CREDITED",
            "ackId": existing_ack,
            "mode": "p2p",
            "npciUsed": False,
            "sourcePeer": req.senderBank,
            "destinationPeer": req.receiverBank,
        }

    account = account_db.get_account(req.receiverId)
    if account is None:
        raise HTTPException(status_code=404, detail=f"Unknown receiver account: {req.receiverId}")

    ack_id = str(uuid.uuid4())
    account_db.apply_credit(req.transactionId, req.receiverId, req.amount, ack_id)
    CREDITS[req.transactionId] = ack_id
    _refresh_accounts_cache()
    logger.info("[%s] Direct P2P credited %s to %s (bypassing NPCI switch)", req.transactionId, req.amount, req.receiverId)
    return {
        "status": "CREDITED",
        "ackId": ack_id,
        "mode": "p2p",
        "npciUsed": False,
        "sourcePeer": req.senderBank,
        "destinationPeer": req.receiverBank,
    }


@app.post("/failure/enable")
def enable_failure():
    FAILURE_STATE["failure_enabled"] = True
    logger.warning("Failure simulation ENABLED")
    return {"failure_enabled": True}


@app.post("/failure/disable")
def disable_failure():
    FAILURE_STATE["failure_enabled"] = False
    logger.info("Failure simulation DISABLED")
    return {"failure_enabled": False}


@app.post("/failure/timeout/enable")
def enable_timeout():
    FAILURE_STATE["timeout_enabled"] = True
    logger.warning("Timeout simulation ENABLED")
    return {"timeout_enabled": True}


@app.post("/failure/timeout/disable")
def disable_timeout():
    FAILURE_STATE["timeout_enabled"] = False
    logger.info("Timeout simulation DISABLED")
    return {"timeout_enabled": False}


@app.get("/failure/status")
def failure_status():
    return dict(FAILURE_STATE)
