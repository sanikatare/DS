"""
Transaction Orchestrator / Transaction Coordinator:
Acts as a central coordinator for the simulated distributed transaction.

Network Architecture:
The Transaction Orchestrator centrally coordinates the distributed transaction by invoking independent Sender Bank, NPCI Switch, and Receiver Bank services via HTTP REST or gRPC (RPC).

Logical Payment Workflow:
Sender Verification -> NPCI Routing -> Receiver Credit

State Machine Model:
Persistent transaction statuses represent the overall lifecycle of a transaction, while detailed service processing steps are represented as communication timeline events.
"""
import asyncio
import logging
import httpx

from app.config import NPCI_URL, RECEIVER_BANK_URL, SENDER_BANK_URL, COMMUNICATION_MODE, REQUEST_TIMEOUT_SECONDS
from app.retry_client import TransactionFailedError, call_with_retry
from app.grpc_client import call_grpc_debit, call_grpc_rollback_debit, call_grpc_route, call_grpc_credit
from app.store import record_timeline, set_status, get_transaction, update_user_balances
from app.ws_manager import manager
from app.mq_producer import publish_debit_request
from common.messaging import broker
from common.mq_consumers import setup_all_consumers

logger = logging.getLogger("transaction-service")


async def _safe_rollback_sender_debit(txn: dict, mode: str = "rest"):
    """Compensating action: restores sender debit if downstream step fails."""
    txn_id = txn["transactionId"]
    record_timeline(
        txn,
        event_type="ROLLBACK_INITIATED",
        service_name="Transaction Service",
        message=f"Initiating compensating rollback of sender debit (mode={mode.upper()})",
    )
    await manager.broadcast({
        "event": "ROLLBACK_INITIATED",
        "transactionId": txn_id,
        "service": "Transaction Service",
        "message": f"Initiating compensating rollback for sender debit ({mode.upper()})",
    })

    try:
        if mode == "grpc":
            await call_grpc_rollback_debit(txn_id, txn=txn)
        else:
            async with httpx.AsyncClient(timeout=3) as client:
                resp = await client.post(
                    f"{SENDER_BANK_URL}/bank/rollback-debit",
                    json={"transactionId": txn_id},
                )
                resp.raise_for_status()

        logger.info("[%s] Rolled back sender debit successfully (mode=%s)", txn_id, mode)
        set_status(txn, "ROLLBACK_COMPLETED")
        record_timeline(
            txn,
            event_type="ROLLBACK_COMPLETED",
            service_name="Sender Bank Service",
            message="Sender debit rolled back successfully to preserve consistency.",
        )
        await manager.broadcast({
            "event": "ROLLBACK_COMPLETED",
            "transactionId": txn_id,
            "service": "Sender Bank Service",
            "status": "ROLLBACK_COMPLETED",
            "message": "Sender debit rolled back to preserve consistency",
        })
    except Exception as exc:
        logger.error("[%s] Rollback attempt failed: %s", txn_id, exc)
        record_timeline(
            txn,
            event_type="ROLLBACK_FAILED",
            service_name="Sender Bank Service",
            message=f"Rollback attempt encountered error: {exc}",
        )
        await manager.broadcast({
            "event": "ROLLBACK_FAILED",
            "transactionId": txn_id,
            "service": "Sender Bank Service",
            "status": "ROLLBACK_FAILED",
            "message": f"Rollback attempt failed: {exc}",
        })


async def _fail_transaction(txn: dict, reason: str):
    txn_id = txn["transactionId"]
    set_status(txn, "FAILED", failure_reason=reason)
    record_timeline(
        txn,
        event_type="TRANSACTION_FAILED",
        service_name="Transaction Service",
        message=f"Transaction failed: {reason}",
    )
    logger.error("[%s] Transaction FAILED: %s", txn_id, reason)
    await manager.broadcast({
        "event": "TRANSACTION_FAILED",
        "transactionId": txn_id,
        "status": "FAILED",
        "reason": reason,
    })


async def process_transaction(txn: dict):
    txn_id = txn["transactionId"]
    mode = (txn.get("mode") or COMMUNICATION_MODE).lower()
    logger.info("[%s] Processing transaction in COMMUNICATION_MODE: %s", txn_id, mode.upper())

    if mode in ("rabbitmq", "mq"):
        if not broker.is_connected:
            await broker.connect()
            await setup_all_consumers()

        set_status(txn, "PROCESSING")
        record_timeline(
            txn,
            event_type="TRANSACTION_INITIATED",
            service_name="Transaction Service",
            message="Payment request received and queued via RabbitMQ message broker",
        )
        await manager.broadcast({
            "event": "TRANSACTION_INITIATED",
            "transactionId": txn_id,
            "status": "PROCESSING",
            "mode": "rabbitmq",
        })

        await publish_debit_request(txn)

        for _ in range(50):
            await asyncio.sleep(0.05)
            current = get_transaction(txn_id)
            if current and current["status"] in ("SUCCESS", "FAILED", "ROLLBACK_COMPLETED"):
                return current

        return get_transaction(txn_id) or txn

    if mode in ("p2p", "peer"):
        set_status(txn, "PROCESSING")
        record_timeline(
            txn,
            event_type="P2P_REQUEST_STARTED",
            service_name="Transaction Service",
            message="Direct Peer-to-Peer payment request initiated (bypassing NPCI switch)",
        )
        await manager.broadcast({
            "event": "P2P_REQUEST_STARTED",
            "transactionId": txn_id,
            "status": "PROCESSING",
            "mode": "p2p",
            "npciUsed": False,
            "sourcePeer": "sender-bank-service",
            "destinationPeer": "receiver-bank-service",
        })

        record_timeline(
            txn,
            event_type="P2P_PEER_CONNECTED",
            service_name="Sender Bank Service",
            message="Direct P2P connection established: sender-bank-service <-> receiver-bank-service",
        )
        await manager.broadcast({
            "event": "P2P_PEER_CONNECTED",
            "transactionId": txn_id,
            "mode": "p2p",
            "npciUsed": False,
            "sourcePeer": "sender-bank-service",
            "destinationPeer": "receiver-bank-service",
        })

        record_timeline(
            txn,
            event_type="P2P_PEER_REQUEST_SENT",
            service_name="Sender Bank Service",
            message="Direct P2P credit payload transmitted from Sender Bank directly to Receiver Bank (NPCI switch bypassed)",
        )
        await manager.broadcast({
            "event": "P2P_PEER_REQUEST_SENT",
            "transactionId": txn_id,
            "mode": "p2p",
            "npciUsed": False,
            "sourcePeer": "sender-bank-service",
            "destinationPeer": "receiver-bank-service",
        })

        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
                p2p_resp = await client.post(
                    f"{SENDER_BANK_URL}/bank/p2p-transfer",
                    json={
                        "senderId": txn["senderId"],
                        "receiverId": txn["receiverId"],
                        "amount": txn["amount"],
                        "transactionId": txn_id,
                        "receiverBankUrl": RECEIVER_BANK_URL,
                    },
                )
                p2p_data = p2p_resp.json()
                if p2p_resp.status_code != 200 or p2p_data.get("status") not in ("SUCCESS", "CREDITED"):
                    reason = p2p_data.get("reason") or p2p_data.get("detail") or "P2P direct transfer failed"
                    if p2p_data.get("rolledBack"):
                        record_timeline(
                            txn,
                            event_type="P2P_ROLLBACK_COMPLETED",
                            service_name="Sender Bank Service",
                            message="P2P transfer failed; sender debit was rolled back compensatingly",
                        )
                        await manager.broadcast({
                            "event": "P2P_ROLLBACK_COMPLETED",
                            "transactionId": txn_id,
                            "mode": "p2p",
                            "npciUsed": False,
                            "reason": reason,
                        })
                    await _fail_transaction(txn, reason)
                    return txn
        except Exception as exc:
            logger.error("[%s] Direct P2P transfer call error: %s", txn_id, exc)
            await _safe_rollback_sender_debit(txn, mode="p2p")
            await _fail_transaction(txn, f"P2P direct communication error: {exc}")
            return txn

        record_timeline(
            txn,
            event_type="P2P_PEER_RESPONSE_RECEIVED",
            service_name="Receiver Bank Service",
            message="Direct ACK received from Receiver Bank (NPCI switch bypassed)",
        )
        await manager.broadcast({
            "event": "P2P_PEER_RESPONSE_RECEIVED",
            "transactionId": txn_id,
            "mode": "p2p",
            "npciUsed": False,
            "ackId": p2p_data.get("ackId"),
            "sourcePeer": "sender-bank-service",
            "destinationPeer": "receiver-bank-service",
        })

        set_status(txn, "SUCCESS")
        update_user_balances(txn["senderId"], txn["receiverId"], txn["amount"])
        record_timeline(
            txn,
            event_type="P2P_TRANSACTION_COMPLETED",
            service_name="Transaction Service",
            message="P2P direct transaction successfully settled without NPCI switch",
        )
        await manager.broadcast({
            "event": "P2P_TRANSACTION_COMPLETED",
            "transactionId": txn_id,
            "status": "SUCCESS",
            "mode": "p2p",
            "npciUsed": False,
        })
        await manager.broadcast({
            "event": "PAYMENT_SUCCESS",
            "transactionId": txn_id,
            "status": "SUCCESS",
            "mode": "p2p",
            "npciUsed": False,
        })
        return txn

    try:
        # Step 0: Initial state PROCESSING
        set_status(txn, "PROCESSING")
        record_timeline(
            txn,
            event_type="TRANSACTION_INITIATED",
            service_name="Transaction Service",
            message=f"Payment request received and validated (Protocol: {mode.upper()})",
        )
        await manager.broadcast({
            "event": "TRANSACTION_INITIATED",
            "transactionId": txn_id,
            "status": "PROCESSING",
            "mode": mode,
        })

        # ---- Step 1: Sender Bank Processing -----------------------------
        record_timeline(
            txn,
            event_type="SENDER_BANK_PROCESSING",
            service_name="Sender Bank Service",
            message=f"Validating sender account and checking available balance ({mode.upper()})",
        )
        await manager.broadcast({
            "event": "SENDER_BANK_PROCESSING",
            "transactionId": txn_id,
            "service": "Sender Bank Service",
            "mode": mode,
        })

        try:
            if mode == "grpc":
                debit_result = await call_grpc_debit(txn["senderId"], txn["amount"], txn_id, txn=txn)
            else:
                debit_result = await call_with_retry(
                    method="POST",
                    url=f"{SENDER_BANK_URL}/bank/debit",
                    json_body={
                        "senderId": txn["senderId"],
                        "amount": txn["amount"],
                        "transactionId": txn_id,
                    },
                    transaction_id=txn_id,
                    service_label="Sender Bank Service",
                    txn=txn,
                )
        except TransactionFailedError as exc:
            await _fail_transaction(txn, exc.reason)
            return txn

        if debit_result.get("approved") is False:
            await _fail_transaction(txn, debit_result.get("reason", "Sender bank declined debit"))
            return txn

        record_timeline(
            txn,
            event_type="SENDER_VERIFIED",
            service_name="Sender Bank Service",
            message=f"Sender account verified & debited successfully ({mode.upper()})",
        )
        await manager.broadcast({
            "event": "SENDER_VERIFIED",
            "transactionId": txn_id,
            "service": "Sender Bank Service",
            "mode": mode,
        })

        # ---- Step 2: NPCI Routing ----------------------------------------
        record_timeline(
            txn,
            event_type="NPCI_PROCESSING",
            service_name="NPCI Simulator Service",
            message=f"Routing transaction across interbank switch ({mode.upper()})",
        )
        await manager.broadcast({
            "event": "NPCI_PROCESSING",
            "transactionId": txn_id,
            "service": "NPCI Simulator Service",
            "mode": mode,
        })

        try:
            if mode == "grpc":
                route_result = await call_grpc_route(txn_id, "sender-bank-service", "receiver-bank-service", txn["amount"], txn=txn)
            else:
                route_result = await call_with_retry(
                    method="POST",
                    url=f"{NPCI_URL}/npci/route",
                    json_body={
                        "transactionId": txn_id,
                        "senderBank": "sender-bank-service",
                        "receiverBank": "receiver-bank-service",
                        "amount": txn["amount"],
                    },
                    transaction_id=txn_id,
                    service_label="NPCI Simulator Service",
                    txn=txn,
                )
        except TransactionFailedError as exc:
            await _safe_rollback_sender_debit(txn, mode=mode)
            await _fail_transaction(txn, exc.reason)
            return txn

        record_timeline(
            txn,
            event_type="NPCI_ROUTED",
            service_name="NPCI Simulator Service",
            message=f"NPCI switch routed request to receiver bank ({mode.upper()})",
        )
        await manager.broadcast({
            "event": "NPCI_ROUTED",
            "transactionId": txn_id,
            "service": "NPCI Simulator Service",
            "mode": mode,
        })

        # ---- Step 3: Receiver Bank Credit --------------------------------
        record_timeline(
            txn,
            event_type="RECEIVER_BANK_PROCESSING",
            service_name="Receiver Bank Service",
            message=f"Processing credit to beneficiary account ({mode.upper()})",
        )
        await manager.broadcast({
            "event": "RECEIVER_BANK_PROCESSING",
            "transactionId": txn_id,
            "service": "Receiver Bank Service",
            "mode": mode,
        })

        try:
            if mode == "grpc":
                credit_result = await call_grpc_credit(txn["receiverId"], txn["amount"], txn_id, txn=txn)
            else:
                credit_result = await call_with_retry(
                    method="POST",
                    url=f"{RECEIVER_BANK_URL}/bank/credit",
                    json_body={
                        "receiverId": txn["receiverId"],
                        "amount": txn["amount"],
                        "transactionId": txn_id,
                    },
                    transaction_id=txn_id,
                    service_label="Receiver Bank Service",
                    txn=txn,
                )
        except TransactionFailedError as exc:
            await _safe_rollback_sender_debit(txn, mode=mode)
            await _fail_transaction(txn, exc.reason)
            return txn

        # ---- Step 4: Final Success ----------------------------------------
        set_status(txn, "SUCCESS")
        update_user_balances(txn["senderId"], txn["receiverId"], txn["amount"])
        record_timeline(
            txn,
            event_type="PAYMENT_SUCCESS",
            service_name="Transaction Service",
            message=f"Transaction successfully completed and settled ({mode.upper()})",
        )
        logger.info("[%s] Transaction SUCCESS (mode=%s)", txn_id, mode)
        await manager.broadcast({
            "event": "PAYMENT_SUCCESS",
            "transactionId": txn_id,
            "status": "SUCCESS",
            "mode": mode,
        })

    except Exception as exc:
        logger.exception("[%s] Unexpected error during processing", txn_id)
        await _fail_transaction(txn, f"Unexpected error: {exc}")

    finally:
        if txn["status"] not in ("SUCCESS", "FAILED"):
            await _fail_transaction(txn, "Transaction did not reach a terminal state")

    return txn
