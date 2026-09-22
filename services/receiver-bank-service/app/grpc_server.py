"""
gRPC Server for Receiver Bank Service (Port 50053).
Invokes the exact same underlying business & SQLite database logic as the REST API.
"""
from concurrent import futures
import logging
import os
import sys
import time
import uuid
from pathlib import Path

# Add services root to sys.path
SERVICES_DIR = str(Path(__file__).resolve().parent.parent.parent)
if SERVICES_DIR not in sys.path:
    sys.path.insert(0, SERVICES_DIR)

import grpc
from services.proto import upi_pb2, upi_pb2_grpc
from . import db as account_db

logger = logging.getLogger("receiver-bank-grpc")

GRPC_PORT = int(os.getenv("RECEIVER_BANK_GRPC_PORT", "50053"))


class ReceiverBankServiceServicer(upi_pb2_grpc.ReceiverBankServiceServicer):

    def Credit(self, request, context):
        logger.info("[gRPC] Credit request received: txn=%s, receiver=%s, amount=%s",
                    request.transaction_id, request.receiver_id, request.amount)

        from .main import FAILURE_STATE, _refresh_accounts_cache, CREDITS

        if FAILURE_STATE.get("failure_enabled"):
            logger.warning("[gRPC] Simulated failure is ON - rejecting credit request")
            context.abort(grpc.StatusCode.UNAVAILABLE, "receiver-bank-service simulated failure")

        if FAILURE_STATE.get("timeout_enabled"):
            logger.warning("[gRPC] Timeout simulation ON - sleeping for 5s")
            time.sleep(5)

        # 1. Idempotency check
        if request.transaction_id in CREDITS:
            logger.info("[%s] Credit already applied (gRPC cache), returning existing ack", request.transaction_id)
            return upi_pb2.CreditResponse(status="CREDITED", ack_id=CREDITS[request.transaction_id], reason="Already credited (cache)")

        existing_ack = account_db.get_credit_ack(request.transaction_id)
        if existing_ack:
            CREDITS[request.transaction_id] = existing_ack
            logger.info("[%s] Credit already applied (gRPC DB), returning existing ack", request.transaction_id)
            return upi_pb2.CreditResponse(status="CREDITED", ack_id=existing_ack, reason="Already credited (DB)")

        account = account_db.get_account(request.receiver_id)
        if account is None:
            context.abort(grpc.StatusCode.NOT_FOUND, f"Unknown receiver account: {request.receiver_id}")

        ack_id = str(uuid.uuid4())
        account_db.apply_credit(request.transaction_id, request.receiver_id, request.amount, ack_id)
        CREDITS[request.transaction_id] = ack_id
        _refresh_accounts_cache()

        logger.info("[%s] Credited %s to %s via gRPC (ack=%s)", request.transaction_id, request.amount, request.receiver_id, ack_id)
        return upi_pb2.CreditResponse(status="CREDITED", ack_id=ack_id, reason="Credit successful")


class DummyServer:
    def stop(self, grace=None):
        pass

def serve_grpc():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    upi_pb2_grpc.add_ReceiverBankServiceServicer_to_server(ReceiverBankServiceServicer(), server)
    try:
        server.add_insecure_port(f"0.0.0.0:{GRPC_PORT}")
        server.start()
        logger.info("Receiver Bank gRPC Server running on port %d", GRPC_PORT)
        return server
    except Exception as exc:
        logger.warning("Receiver Bank gRPC port %d already bound (%s), using existing binding", GRPC_PORT, exc)
        return DummyServer()
