"""
Sender Bank Service
--------------------
Simulates the sender's bank. Validates account balance and handles
debit / rollback for a transaction. Also supports controllable
failure simulation for the fault-tolerance demo.

Port: 8001
"""
import asyncio
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import db as account_db

SERVICE_NAME = "sender-bank-service"
SERVICE_ROLE = "Validates sender account and handles debit / rollback"
SERVICE_PORT = 8001

# Deliberately long sleep for the timeout demo: comfortably longer than the
# transaction-service's REQUEST_TIMEOUT_SECONDS (3s), so it reliably trips a
# client-side timeout rather than a slow-but-successful response.
TIMEOUT_SIMULATION_DELAY_SECONDS = 5

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(SERVICE_NAME)

app = FastAPI(
    title="UPI Simulator - Sender Bank Service",
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

# ---------------------------------------------------------------------------
# Account balances and debit records persisted in SQLite (see app/db.py).
# ACCOUNTS is a read-through cache refreshed after each write.
# ---------------------------------------------------------------------------
ACCOUNTS: dict[str, dict] = {}

# transactionId -> {senderId, amount} — kept in memory for fast idempotent
# debit lookups; mirrored in SQLite debits table.
DEBITS: dict[str, dict] = {}

# ---------------------------------------------------------------------------
# Failure simulation state
# ---------------------------------------------------------------------------
FAILURE_STATE = {
    "failure_enabled": False,
    "timeout_enabled": False,
}


class DebitRequest(BaseModel):
    senderId: str
    amount: float
    transactionId: str


class RollbackRequest(BaseModel):
    transactionId: str


class P2PTransferRequest(BaseModel):
    senderId: str
    receiverId: str
    amount: float
    transactionId: str
    receiverBankUrl: str | None = None


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
        logger.warning("Could not start Sender Bank gRPC server: %s", exc)
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
    """Used by the transaction service / frontend to show mock users + balances."""
    return {"accounts": [{"id": k, **v} for k, v in ACCOUNTS.items()]}


@app.post("/bank/debit")
async def debit(req: DebitRequest):
    _simulate_failure_if_enabled()
    await _simulate_timeout_if_enabled()

    if req.transactionId in DEBITS:
        # Already debited for this transaction (e.g. a retried call after a
        # response was lost) - treat as idempotent success.
        logger.info("[%s] Debit already applied, returning existing result", req.transactionId)
        return {"status": "DEBITED", "approved": True, "accountId": req.senderId}

    existing = account_db.get_debit(req.transactionId)
    if existing:
        DEBITS[req.transactionId] = existing
        logger.info("[%s] Debit already applied (from DB), returning existing result", req.transactionId)
        return {"status": "DEBITED", "approved": True, "accountId": req.senderId}

    account = account_db.get_account(req.senderId)
    if account is None:
        raise HTTPException(status_code=404, detail=f"Unknown sender account: {req.senderId}")

    if account["balance"] < req.amount:
        logger.info("[%s] Debit declined - insufficient balance", req.transactionId)
        return {"status": "DECLINED", "approved": False, "reason": "Insufficient balance"}

    account_db.apply_debit(req.transactionId, req.senderId, req.amount)
    DEBITS[req.transactionId] = {"senderId": req.senderId, "amount": req.amount}
    _refresh_accounts_cache()
    logger.info("[%s] Debited %s from %s", req.transactionId, req.amount, req.senderId)
    return {"status": "DEBITED", "approved": True, "accountId": req.senderId}


@app.post("/bank/rollback-debit")
async def rollback_debit(req: RollbackRequest):
    DEBITS.pop(req.transactionId, None)
    debit_record = account_db.rollback_debit(req.transactionId)
    if debit_record is None:
        logger.info("[%s] Rollback requested but no debit on record (no-op)", req.transactionId)
        return {"status": "NO_DEBIT_FOUND"}

    _refresh_accounts_cache()
    logger.info(
        "[%s] Rolled back %s to %s",
        req.transactionId,
        debit_record["amount"],
        debit_record["senderId"],
    )
    return {"status": "ROLLED_BACK", "amount": debit_record["amount"]}


@app.post("/bank/p2p-transfer")
async def p2p_transfer(req: P2PTransferRequest):
    _simulate_failure_if_enabled()
    await _simulate_timeout_if_enabled()

    account = account_db.get_account(req.senderId)
    if account is None:
        raise HTTPException(status_code=404, detail=f"Unknown sender account: {req.senderId}")

    if account["balance"] < req.amount:
        logger.info("[%s] P2P Debit declined - insufficient balance", req.transactionId)
        return {"status": "DECLINED", "approved": False, "reason": "Insufficient balance", "rolledBack": False}

    # Apply local debit idempotently
    if req.transactionId not in DEBITS and not account_db.get_debit(req.transactionId):
        account_db.apply_debit(req.transactionId, req.senderId, req.amount)
        DEBITS[req.transactionId] = {"senderId": req.senderId, "amount": req.amount}
        _refresh_accounts_cache()

    target_url = req.receiverBankUrl or "http://localhost:8003"
    peer_endpoint = f"{target_url.rstrip('/')}/peer/credit"

    logger.info("[%s] Sender Bank establishing direct P2P connection to %s (bypassing NPCI)", req.transactionId, peer_endpoint)

    try:
        import httpx
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(
                peer_endpoint,
                json={
                    "transactionId": req.transactionId,
                    "senderId": req.senderId,
                    "receiverId": req.receiverId,
                    "amount": req.amount,
                    "senderBank": SERVICE_NAME,
                    "receiverBank": "receiver-bank-service",
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "status": "SUCCESS",
                    "ackId": data.get("ackId"),
                    "mode": "p2p",
                    "npciUsed": False,
                    "sourcePeer": SERVICE_NAME,
                    "destinationPeer": "receiver-bank-service",
                }
            else:
                detail = resp.json().get("detail", f"Receiver peer HTTP {resp.status_code}")
                logger.warning("[%s] P2P credit failed (%s). Executing Saga rollback.", req.transactionId, detail)
                account_db.rollback_debit(req.transactionId)
                DEBITS.pop(req.transactionId, None)
                _refresh_accounts_cache()
                return {"status": "FAILED", "reason": detail, "rolledBack": True}
    except Exception as exc:
        logger.warning("[%s] Direct P2P transport exception (%s). Executing Saga rollback.", req.transactionId, exc)
        account_db.rollback_debit(req.transactionId)
        DEBITS.pop(req.transactionId, None)
        _refresh_accounts_cache()
        return {"status": "FAILED", "reason": f"Direct P2P credit call failed: {exc}", "rolledBack": True}


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
