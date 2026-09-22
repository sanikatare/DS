"""
Reusable gRPC Client for Transaction Service.
Handles gRPC channel management, deadlines, retries, and Circuit Breaker integration.
"""
import asyncio
import logging

import grpc

from app.config import (
    SENDER_BANK_GRPC_URL,
    NPCI_GRPC_URL,
    RECEIVER_BANK_GRPC_URL,
    MAX_RETRIES,
    REQUEST_TIMEOUT_SECONDS,
    RETRY_DELAY_SECONDS,
    CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    CIRCUIT_BREAKER_RECOVERY_TIMEOUT,
    CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
)
from app.retry_client import TransactionFailedError
from app.store import record_timeline
from app.ws_manager import manager
from services.common.circuit_breaker import circuit_breaker_registry
from services.proto import upi_pb2, upi_pb2_grpc

logger = logging.getLogger("transaction-service-grpc-client")


async def call_grpc_debit(sender_id: str, amount: float, transaction_id: str, txn: dict | None = None) -> dict:
    channel = grpc.insecure_channel(SENDER_BANK_GRPC_URL)
    stub = upi_pb2_grpc.SenderBankServiceStub(channel)
    req = upi_pb2.DebitRequest(sender_id=sender_id, amount=amount, transaction_id=transaction_id)

    return await call_grpc_with_retry(
        stub_call_func=stub.Debit,
        request_obj=req,
        transaction_id=transaction_id,
        service_label="Sender Bank Service",
        txn=txn,
    )


async def call_grpc_rollback_debit(transaction_id: str, txn: dict | None = None) -> dict:
    channel = grpc.insecure_channel(SENDER_BANK_GRPC_URL)
    stub = upi_pb2_grpc.SenderBankServiceStub(channel)
    req = upi_pb2.RollbackRequest(transaction_id=transaction_id)

    return await call_grpc_with_retry(
        stub_call_func=stub.RollbackDebit,
        request_obj=req,
        transaction_id=transaction_id,
        service_label="Sender Bank Service",
        txn=txn,
    )


async def call_grpc_route(transaction_id: str, sender_bank: str, receiver_bank: str, amount: float, txn: dict | None = None) -> dict:
    channel = grpc.insecure_channel(NPCI_GRPC_URL)
    stub = upi_pb2_grpc.NPCISwitchServiceStub(channel)
    req = upi_pb2.RouteRequest(transaction_id=transaction_id, sender_bank=sender_bank, receiver_bank=receiver_bank, amount=amount)

    return await call_grpc_with_retry(
        stub_call_func=stub.Route,
        request_obj=req,
        transaction_id=transaction_id,
        service_label="NPCI Simulator Service",
        txn=txn,
    )


async def call_grpc_credit(receiver_id: str, amount: float, transaction_id: str, txn: dict | None = None) -> dict:
    channel = grpc.insecure_channel(RECEIVER_BANK_GRPC_URL)
    stub = upi_pb2_grpc.ReceiverBankServiceStub(channel)
    req = upi_pb2.CreditRequest(receiver_id=receiver_id, amount=amount, transaction_id=transaction_id)

    return await call_grpc_with_retry(
        stub_call_func=stub.Credit,
        request_obj=req,
        transaction_id=transaction_id,
        service_label="Receiver Bank Service",
        txn=txn,
    )


async def call_grpc_with_retry(
    *,
    stub_call_func,
    request_obj,
    transaction_id: str,
    service_label: str,
    txn: dict | None = None,
) -> dict:
    """
    Executes a gRPC call with circuit breaker protection, deadline enforcement,
    and automatic retries on transient network/RPC errors.
    """
    circuit_label = f"{service_label} (gRPC)"
    breaker = circuit_breaker_registry.get_breaker(
        name=circuit_label,
        failure_threshold=CIRCUIT_BREAKER_FAILURE_THRESHOLD,
        recovery_timeout=CIRCUIT_BREAKER_RECOVERY_TIMEOUT,
        success_threshold=CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
    )

    if not await breaker.can_execute():
        reason = f"Circuit breaker is {breaker.state.value} for {circuit_label} - fast-failing gRPC request"
        logger.warning("[%s] %s", transaction_id, reason)
        if txn is not None:
            record_timeline(
                txn,
                event_type="CIRCUIT_BREAKER_FAST_FAIL",
                service_name=circuit_label,
                message=reason,
            )
        await manager.broadcast({
            "event": "CIRCUIT_BREAKER_FAST_FAIL",
            "transactionId": transaction_id,
            "service": circuit_label,
            "circuitState": breaker.state.value,
            "reason": reason,
        })
        raise TransactionFailedError(reason)

    last_error: Exception | None = None
    was_timeout = False

    logger.info("[gRPC] [%s] Calling %s (Circuit: %s)", transaction_id, circuit_label, breaker.state.value)

    for attempt in range(0, MAX_RETRIES + 1):
        try:
            response = await asyncio.to_thread(
                stub_call_func, request_obj, timeout=REQUEST_TIMEOUT_SECONDS
            )

            await breaker.record_success()
            if attempt > 0:
                logger.info("[gRPC] [%s] %s succeeded on retry attempt %d", transaction_id, circuit_label, attempt)

            res_dict = {}
            if hasattr(response, "status"):
                res_dict["status"] = response.status
            if hasattr(response, "approved"):
                res_dict["approved"] = response.approved
            if hasattr(response, "account_id"):
                res_dict["accountId"] = response.account_id
            if hasattr(response, "ack_id"):
                res_dict["ackId"] = response.ack_id
            if hasattr(response, "reason"):
                res_dict["reason"] = response.reason

            return res_dict

        except grpc.RpcError as exc:
            last_error = exc
            status_code = exc.code() if hasattr(exc, "code") else None
            was_timeout = status_code == grpc.StatusCode.DEADLINE_EXCEEDED
            logger.warning("[gRPC] [%s] %s failure detected: code=%s, details=%s",
                           transaction_id, circuit_label, status_code, exc.details() if hasattr(exc, "details") else exc)

        await breaker.record_failure()

        if attempt == 0:
            if txn is not None:
                record_timeline(
                    txn,
                    event_type="SERVICE_FAILURE_DETECTED",
                    service_name=circuit_label,
                    message=f"gRPC Failure detected on {circuit_label}: {last_error}",
                )
            await manager.broadcast({
                "event": "SERVICE_FAILURE_DETECTED",
                "transactionId": transaction_id,
                "service": circuit_label,
                "reason": "Timeout (Deadline Exceeded)" if was_timeout else str(last_error),
            })

        if attempt < MAX_RETRIES:
            next_attempt = attempt + 1
            logger.info("[gRPC] [%s] Retry attempt %d/%d for %s", transaction_id, next_attempt, MAX_RETRIES, circuit_label)
            if txn is not None:
                record_timeline(
                    txn,
                    event_type=f"RETRY_ATTEMPT_{next_attempt}",
                    service_name=circuit_label,
                    message=f"Automated gRPC retry attempt {next_attempt}/{MAX_RETRIES} for {circuit_label}",
                )
            await manager.broadcast({
                "event": f"RETRY_ATTEMPT_{next_attempt}",
                "transactionId": transaction_id,
                "service": circuit_label,
                "attempt": next_attempt,
            })
            await asyncio.sleep(RETRY_DELAY_SECONDS)

    reason = f"{circuit_label} unavailable after {MAX_RETRIES + 1} gRPC attempts ({last_error})"
    logger.error("[gRPC] [%s] %s - all retry attempts exhausted", transaction_id, circuit_label)
    raise TransactionFailedError(reason)
