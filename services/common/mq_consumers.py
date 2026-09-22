"""
RabbitMQ Consumer Event Handlers for UPI Distributed Transaction Simulator (Phase 3).
Connects to RabbitMQ queues and executes microservice business logic asynchronously.
"""

import asyncio
import importlib.util
import logging
import os
import sys
import types
import uuid
from pathlib import Path
from typing import Dict, Any

from common.messaging import (
    broker,
    QUEUE_DEBIT,
    QUEUE_ROUTE,
    QUEUE_CREDIT,
    QUEUE_ROLLBACK,
    ROUTING_KEY_ROUTE,
    ROUTING_KEY_CREDIT,
    ROUTING_KEY_ROLLBACK,
    create_event_payload,
)

logger = logging.getLogger("mq_consumers")

# Dynamic module loader for microservices
BASE_DIR = Path(__file__).resolve().parent.parent

def _get_or_load_module(mod_name: str, file_path: Path, package_name: str):
    if mod_name in sys.modules:
        return sys.modules[mod_name]
    if package_name and package_name not in sys.modules:
        pkg_mod = types.ModuleType(package_name)
        pkg_mod.__path__ = [str(file_path.parent)]
        pkg_mod.__file__ = str(file_path.parent / "__init__.py")
        sys.modules[package_name] = pkg_mod

    spec = importlib.util.spec_from_file_location(mod_name, str(file_path))
    mod = importlib.util.module_from_spec(spec)
    if package_name:
        mod.__package__ = package_name
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


sender_db = _get_or_load_module("sender_pkg.db", BASE_DIR / "sender-bank-service" / "app" / "db.py", "sender_pkg")
sender_main = _get_or_load_module("sender_pkg.main", BASE_DIR / "sender-bank-service" / "app" / "main.py", "sender_pkg")
sender_grpc = _get_or_load_module("sender_pkg.grpc_server", BASE_DIR / "sender-bank-service" / "app" / "grpc_server.py", "sender_pkg")

npci_main = _get_or_load_module("npci_pkg.main", BASE_DIR / "npci-simulator-service" / "app" / "main.py", "npci_pkg")
npci_grpc = _get_or_load_module("npci_pkg.grpc_server", BASE_DIR / "npci-simulator-service" / "app" / "grpc_server.py", "npci_pkg")

receiver_db = _get_or_load_module("receiver_pkg.db", BASE_DIR / "receiver-bank-service" / "app" / "db.py", "receiver_pkg")
receiver_main = _get_or_load_module("receiver_pkg.main", BASE_DIR / "receiver-bank-service" / "app" / "main.py", "receiver_pkg")
receiver_grpc = _get_or_load_module("receiver_pkg.grpc_server", BASE_DIR / "receiver-bank-service" / "app" / "grpc_server.py", "receiver_pkg")

from app.store import get_transaction, set_status, record_timeline
from app.ws_manager import manager


async def handle_sender_debit(payload: Dict[str, Any], msg: Any):
    """Consumer for q.sender.debit"""
    txn_id = payload["transactionId"]
    sender_id = payload.get("senderId", "sanika")
    amount = float(payload.get("amount", 0.0))
    logger.info("[MQ Consumer] Received DEBIT_REQUEST for txn=%s, sender=%s, amount=%.2f", txn_id, sender_id, amount)

    # 1. Failure simulation check
    if sender_main.FAILURE_STATE.get("failure_enabled"):
        logger.warning("[MQ Consumer] Sender bank simulated failure is ENABLED - rejecting debit for txn=%s", txn_id)
        txn = get_transaction(txn_id)
        if txn:
            set_status(txn, "FAILED", failure_reason="Sender Bank Service simulated failure")
            record_timeline(txn, "TRANSACTION_FAILED", service_name="Sender Bank Service", message="Sender Bank Service simulated failure (MQ)")
            await manager.broadcast({"event": "TRANSACTION_FAILED", "transactionId": txn_id, "status": "FAILED", "reason": "Sender Bank Service simulated failure"})
        raise RuntimeError("Sender Bank Service simulated failure")

    # 2. Idempotency check
    existing_debit = sender_db.get_debit(txn_id) or sender_main.DEBITS.get(txn_id)
    if existing_debit:
        logger.info("[MQ Consumer] [%s] Sender debit already applied (idempotent hit)", txn_id)
    else:
        account = sender_db.get_account(sender_id)
        if not account or account["balance"] < amount:
            logger.warning("[MQ Consumer] [%s] Sender debit declined (insufficient balance or invalid account)", txn_id)
            txn = get_transaction(txn_id)
            if txn:
                set_status(txn, "FAILED", failure_reason="Insufficient balance")
                record_timeline(txn, "TRANSACTION_FAILED", service_name="Sender Bank Service", message="Insufficient balance")
                await manager.broadcast({"event": "TRANSACTION_FAILED", "transactionId": txn_id, "status": "FAILED", "reason": "Insufficient balance"})
            return

        sender_db.apply_debit(txn_id, sender_id, amount)
        sender_main.DEBITS[txn_id] = {"senderId": sender_id, "amount": amount}
        sender_main._refresh_accounts_cache()
        logger.info("[MQ Consumer] [%s] Debited %.2f from %s via MQ", txn_id, amount, sender_id)

    txn = get_transaction(txn_id)
    if txn:
        record_timeline(txn, "SENDER_VERIFIED", service_name="Sender Bank Service", message="Sender account debited via RabbitMQ")
        await manager.broadcast({"event": "SENDER_VERIFIED", "transactionId": txn_id, "service": "Sender Bank Service", "mode": "rabbitmq"})

    # Forward to NPCI route queue
    route_payload = create_event_payload(
        transaction_id=txn_id,
        event_type="ROUTE_REQUEST",
        sender_id=sender_id,
        receiver_id=payload.get("receiverId", "navya"),
        sender_bank="sender-bank-service",
        receiver_bank="receiver-bank-service",
        amount=amount,
        status="PROCESSING",
    )
    await broker.publish(ROUTING_KEY_ROUTE, route_payload)


async def handle_npci_route(payload: Dict[str, Any], msg: Any):
    """Consumer for q.npci.route"""
    txn_id = payload["transactionId"]
    logger.info("[MQ Consumer] Received ROUTE_REQUEST for txn=%s", txn_id)

    # 1. Failure simulation check
    if npci_main.FAILURE_STATE.get("failure_enabled"):
        logger.warning("[MQ Consumer] NPCI switch simulated failure is ENABLED - rejecting route for txn=%s", txn_id)
        # Trigger saga rollback
        rollback_payload = create_event_payload(
            transaction_id=txn_id,
            event_type="ROLLBACK_REQUEST",
            sender_id=payload.get("senderId", ""),
            receiver_id=payload.get("receiverId", ""),
            amount=float(payload.get("amount", 0.0)),
            status="ROLLBACK_INITIATED",
            error="NPCI Switch Service simulated failure",
        )
        await broker.publish(ROUTING_KEY_ROLLBACK, rollback_payload)
        raise RuntimeError("NPCI Switch Service simulated failure")

    await asyncio.sleep(0.05)
    npci_main.ROUTED_COUNT["count"] += 1

    txn = get_transaction(txn_id)
    if txn:
        record_timeline(txn, "NPCI_ROUTED", service_name="NPCI Simulator Service", message="NPCI switch routed request to receiver bank via RabbitMQ")
        await manager.broadcast({"event": "NPCI_ROUTED", "transactionId": txn_id, "service": "NPCI Simulator Service", "mode": "rabbitmq"})

    credit_payload = create_event_payload(
        transaction_id=txn_id,
        event_type="CREDIT_REQUEST",
        sender_id=payload.get("senderId", ""),
        receiver_id=payload.get("receiverId", ""),
        sender_bank="sender-bank-service",
        receiver_bank="receiver-bank-service",
        amount=float(payload.get("amount", 0.0)),
        status="PROCESSING",
    )
    await broker.publish(ROUTING_KEY_CREDIT, credit_payload)


async def handle_receiver_credit(payload: Dict[str, Any], msg: Any):
    """Consumer for q.receiver.credit"""
    txn_id = payload["transactionId"]
    receiver_id = payload.get("receiverId", "navya")
    amount = float(payload.get("amount", 0.0))
    logger.info("[MQ Consumer] Received CREDIT_REQUEST for txn=%s, receiver=%s, amount=%.2f", txn_id, receiver_id, amount)

    # 1. Failure simulation check
    if receiver_main.FAILURE_STATE.get("failure_enabled"):
        logger.warning("[MQ Consumer] Receiver bank simulated failure is ENABLED - initiating Saga compensating rollback for txn=%s", txn_id)
        txn = get_transaction(txn_id)
        if txn:
            record_timeline(txn, "ROLLBACK_INITIATED", service_name="Transaction Service", message="Receiver Bank failed - initiating compensating rollback over MQ")
            await manager.broadcast({"event": "ROLLBACK_INITIATED", "transactionId": txn_id, "service": "Transaction Service", "message": "Initiating compensating rollback"})

        rollback_payload = create_event_payload(
            transaction_id=txn_id,
            event_type="ROLLBACK_REQUEST",
            sender_id=payload.get("senderId", ""),
            receiver_id=receiver_id,
            amount=amount,
            status="ROLLBACK_INITIATED",
            error="Receiver Bank Service simulated failure",
        )
        await broker.publish(ROUTING_KEY_ROLLBACK, rollback_payload)
        raise RuntimeError("Receiver Bank Service simulated failure")

    # 2. Idempotency check
    existing_ack = receiver_db.get_credit_ack(txn_id) or receiver_main.CREDITS.get(txn_id)
    if existing_ack:
        logger.info("[MQ Consumer] [%s] Receiver credit already applied (idempotent hit)", txn_id)
        ack_id = existing_ack
    else:
        account = receiver_db.get_account(receiver_id)
        if not account:
            logger.warning("[MQ Consumer] [%s] Receiver credit failed - unknown account %s", txn_id, receiver_id)
            rollback_payload = create_event_payload(
                transaction_id=txn_id,
                event_type="ROLLBACK_REQUEST",
                sender_id=payload.get("senderId", ""),
                receiver_id=receiver_id,
                amount=amount,
                status="ROLLBACK_INITIATED",
                error=f"Unknown receiver account {receiver_id}",
            )
            await broker.publish(ROUTING_KEY_ROLLBACK, rollback_payload)
            return

        ack_id = str(uuid.uuid4())
        receiver_db.apply_credit(txn_id, receiver_id, amount, ack_id)
        receiver_main.CREDITS[txn_id] = ack_id
        receiver_main._refresh_accounts_cache()
        logger.info("[MQ Consumer] [%s] Credited %.2f to %s via MQ (ack=%s)", txn_id, amount, receiver_id, ack_id)

    txn = get_transaction(txn_id)
    if txn:
        set_status(txn, "SUCCESS")
        record_timeline(txn, "PAYMENT_SUCCESS", service_name="Transaction Service", message="Transaction successfully completed and settled via RabbitMQ")
        await manager.broadcast({"event": "PAYMENT_SUCCESS", "transactionId": txn_id, "status": "SUCCESS", "mode": "rabbitmq"})


async def handle_sender_rollback(payload: Dict[str, Any], msg: Any):
    """Consumer for q.sender.rollback"""
    txn_id = payload["transactionId"]
    error_reason = payload.get("error") or "Receiver bank transaction credit failed"
    logger.info("[MQ Consumer] Received ROLLBACK_REQUEST for txn=%s (reason: %s)", txn_id, error_reason)

    sender_main.DEBITS.pop(txn_id, None)
    debit_record = sender_db.rollback_debit(txn_id)
    if debit_record:
        sender_main._refresh_accounts_cache()
        logger.info("[MQ Consumer] [%s] Sender debit rolled back (%.2f returned to %s)", txn_id, debit_record["amount"], debit_record["senderId"])

    txn = get_transaction(txn_id)
    if txn:
        set_status(txn, "FAILED", failure_reason=error_reason)
        record_timeline(txn, "ROLLBACK_COMPLETED", service_name="Sender Bank Service", message=f"Sender debit rolled back to preserve consistency: {error_reason}")
        record_timeline(txn, "TRANSACTION_FAILED", service_name="Transaction Service", message=f"Transaction failed: {error_reason}")
        await manager.broadcast({"event": "ROLLBACK_COMPLETED", "transactionId": txn_id, "status": "ROLLBACK_COMPLETED", "message": "Sender debit rolled back"})
        await manager.broadcast({"event": "TRANSACTION_FAILED", "transactionId": txn_id, "status": "FAILED", "reason": error_reason})


async def setup_all_consumers():
    """Initializes and registers all 4 MQ queue consumers."""
    if not broker.is_connected:
        await broker.connect()

    await broker.start_consumer(QUEUE_DEBIT, handle_sender_debit)
    await broker.start_consumer(QUEUE_ROUTE, handle_npci_route)
    await broker.start_consumer(QUEUE_CREDIT, handle_receiver_credit)
    await broker.start_consumer(QUEUE_ROLLBACK, handle_sender_rollback)
    logger.info("[MQ] All 4 RabbitMQ queue consumers started successfully.")
