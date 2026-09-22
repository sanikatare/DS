"""
gRPC Server for Sender Bank Service (Port 50051).
Invokes the exact same underlying business & SQLite database logic as the REST API.
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
from . import db as account_db

logger = logging.getLogger("sender-bank-grpc")

GRPC_PORT = int(os.getenv("SENDER_BANK_GRPC_PORT", "50051"))


class SenderBankServiceServicer(upi_pb2_grpc.SenderBankServiceServicer):

    def Debit(self, request, context):
        logger.info("[gRPC] Debit request received: txn=%s, sender=%s, amount=%s",
                    request.transaction_id, request.sender_id, request.amount)

        from .main import FAILURE_STATE, _refresh_accounts_cache, DEBITS

        if FAILURE_STATE.get("failure_enabled"):
            logger.warning("[gRPC] Simulated failure is ON - rejecting request")
            context.abort(grpc.StatusCode.UNAVAILABLE, "sender-bank-service simulated failure")

        if FAILURE_STATE.get("timeout_enabled"):
            logger.warning("[gRPC] Timeout simulation ON - sleeping for 5s")
            time.sleep(5)

        # 1. Idempotency check
        if request.transaction_id in DEBITS or account_db.get_debit(request.transaction_id):
            logger.info("[%s] Debit already applied (gRPC), returning idempotent result", request.transaction_id)
            return upi_pb2.DebitResponse(
                status="DEBITED",
                approved=True,
                account_id=request.sender_id,
                reason="Idempotent duplicate request",
            )

        account = account_db.get_account(request.sender_id)
        if account is None:
            context.abort(grpc.StatusCode.NOT_FOUND, f"Unknown sender account: {request.sender_id}")

        if account["balance"] < request.amount:
            logger.info("[%s] Debit declined (gRPC) - insufficient balance", request.transaction_id)
            return upi_pb2.DebitResponse(
                status="DECLINED",
                approved=False,
                account_id=request.sender_id,
                reason="Insufficient balance",
            )

        account_db.apply_debit(request.transaction_id, request.sender_id, request.amount)
        DEBITS[request.transaction_id] = {"senderId": request.sender_id, "amount": request.amount}
        _refresh_accounts_cache()

        logger.info("[%s] Debited %s from %s via gRPC", request.transaction_id, request.amount, request.sender_id)
        return upi_pb2.DebitResponse(
            status="DEBITED",
            approved=True,
            account_id=request.sender_id,
            reason="Debit successful",
        )

    def RollbackDebit(self, request, context):
        logger.info("[gRPC] RollbackDebit request received: txn=%s", request.transaction_id)
        from .main import _refresh_accounts_cache, DEBITS

        DEBITS.pop(request.transaction_id, None)
        debit_record = account_db.rollback_debit(request.transaction_id)
        if debit_record is None:
            logger.info("[%s] Rollback requested but no debit on record (gRPC no-op)", request.transaction_id)
            return upi_pb2.RollbackResponse(status="NO_DEBIT_FOUND", amount=0.0)

        _refresh_accounts_cache()
        logger.info("[%s] Rolled back %s to %s via gRPC", request.transaction_id, debit_record["amount"], debit_record["senderId"])
        return upi_pb2.RollbackResponse(status="ROLLED_BACK", amount=debit_record["amount"])


class DummyServer:
    def stop(self, grace=None):
        pass

def serve_grpc():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    upi_pb2_grpc.add_SenderBankServiceServicer_to_server(SenderBankServiceServicer(), server)
    try:
        server.add_insecure_port(f"0.0.0.0:{GRPC_PORT}")
        server.start()
        logger.info("Sender Bank gRPC Server running on port %d", GRPC_PORT)
        return server
    except Exception as exc:
        logger.warning("Sender Bank gRPC port %d already bound (%s), using existing binding", GRPC_PORT, exc)
        return DummyServer()
