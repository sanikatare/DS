"""
NPCI Simulator Service
------------------------
Simulates the NPCI switch that routes a transaction between the sender
bank and receiver bank - the middleware layer between the two banks.
Also supports controllable failure simulation for the fault-tolerance
demo.

Port: 8002
"""
import asyncio
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

SERVICE_NAME = "npci-simulator-service"
SERVICE_ROLE = "Routes transactions between sender bank and receiver bank (middleware/switch)"
SERVICE_PORT = 8002

TIMEOUT_SIMULATION_DELAY_SECONDS = 5

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(SERVICE_NAME)

app = FastAPI(
    title="UPI Simulator - NPCI Simulator Service",
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

FAILURE_STATE = {
    "failure_enabled": False,
    "timeout_enabled": False,
}

from .grpc_server import serve_grpc


@app.on_event("startup")
def on_startup():
    try:
        serve_grpc()
    except Exception as exc:
        logger.warning("Could not start NPCI gRPC server: %s", exc)


# Just for a routing log / demo realism - not persisted state.
ROUTED_COUNT = {"count": 0}


class RouteRequest(BaseModel):
    transactionId: str
    senderBank: str
    receiverBank: str
    amount: float


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


@app.post("/npci/route")
async def route(req: RouteRequest):
    _simulate_failure_if_enabled()
    await _simulate_timeout_if_enabled()

    # Small realistic processing delay for the "switch" doing its routing work.
    await asyncio.sleep(0.3)

    ROUTED_COUNT["count"] += 1
    logger.info(
        "[%s] Routed %s -> %s for amount %s",
        req.transactionId, req.senderBank, req.receiverBank, req.amount,
    )
    return {"status": "ROUTED", "transactionId": req.transactionId}


@app.get("/npci/health/{bank_id}")
def bank_health(bank_id: str):
    """Simulated health check endpoint for a given bank, as referenced in the design doc."""
    return {"bankId": bank_id, "status": "reachable"}


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
