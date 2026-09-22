"""
gRPC Server for NPCI Simulator Service (Port 50052).
Invokes the exact same underlying business logic as the REST API.
"""
from concurrent import futures
import logging
import os
import sys
import time
from pathlib import Path

# Add services root to sys.path
SERVICES_DIR = str(Path(__file__).resolve().parent.parent.parent)
if SERVICES_DIR not in sys.path:
    sys.path.insert(0, SERVICES_DIR)

import grpc
from services.proto import upi_pb2, upi_pb2_grpc

logger = logging.getLogger("npci-simulator-grpc")

GRPC_PORT = int(os.getenv("NPCI_GRPC_PORT", "50052"))


class NPCISwitchServiceServicer(upi_pb2_grpc.NPCISwitchServiceServicer):

    def Route(self, request, context):
        logger.info("[gRPC] Route request received: txn=%s, %s -> %s for amount %s",
                    request.transaction_id, request.sender_bank, request.receiver_bank, request.amount)

        from .main import FAILURE_STATE, ROUTED_COUNT

        if FAILURE_STATE.get("failure_enabled"):
            logger.warning("[gRPC] Simulated failure is ON - rejecting route request")
            context.abort(grpc.StatusCode.UNAVAILABLE, "npci-simulator-service simulated failure")

        if FAILURE_STATE.get("timeout_enabled"):
            logger.warning("[gRPC] Timeout simulation ON - sleeping for 5s")
            time.sleep(5)

        time.sleep(0.3)  # Switch processing delay
        ROUTED_COUNT["count"] += 1

        logger.info("[%s] Routed via gRPC: %s -> %s", request.transaction_id, request.sender_bank, request.receiver_bank)
        return upi_pb2.RouteResponse(status="ROUTED", transaction_id=request.transaction_id)


class DummyServer:
    def stop(self, grace=None):
        pass

def serve_grpc():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    upi_pb2_grpc.add_NPCISwitchServiceServicer_to_server(NPCISwitchServiceServicer(), server)
    try:
        server.add_insecure_port(f"0.0.0.0:{GRPC_PORT}")
        server.start()
        logger.info("NPCI Simulator gRPC Server running on port %d", GRPC_PORT)
        return server
    except Exception as exc:
        logger.warning("NPCI gRPC port %d already bound (%s), using existing binding", GRPC_PORT, exc)
        return DummyServer()
