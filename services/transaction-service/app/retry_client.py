"""
Reusable retry, timeout, and Circuit Breaker wrapper for fault-tolerant inter-service communication.

Every downstream call (Sender Bank, NPCI, Receiver Bank) goes through
call_with_retry so retry/timeout/circuit-breaker/logging/WS-event behavior is
defined once instead of duplicated per service call.
"""
import asyncio
import logging

import httpx

from app.config import (
    MAX_RETRIES,
    REQUEST_TIMEOUT_SECONDS,
    RETRY_DELAY_SECONDS,
    CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    CIRCUIT_BREAKER_RECOVERY_TIMEOUT,
    CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
)
from app.store import record_timeline
from app.ws_manager import manager
from services.common.circuit_breaker import circuit_breaker_registry, CircuitState

logger = logging.getLogger("transaction-service")


class TransactionFailedError(Exception):
    """Raised once all retry attempts for a downstream call are exhausted or circuit breaker fast-fails."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


async def call_with_retry(
    *,
    method: str,
    url: str,
    json_body: dict,
    transaction_id: str,
    service_label: str,
    txn: dict | None = None,
) -> dict:
    """
    Calls a downstream service with a configurable timeout and circuit breaker protection,
    retrying up to MAX_RETRIES additional times on connection errors, timeouts, or 5xx
    responses. Emits SERVICE_FAILURE_DETECTED / RETRY_ATTEMPT_N / CIRCUIT_BREAKER_* WebSocket
    events as failures occur or when fast-failing. Raises TransactionFailedError if every attempt fails.
    """
    breaker = circuit_breaker_registry.get_breaker(
        name=service_label,
        failure_threshold=CIRCUIT_BREAKER_FAILURE_THRESHOLD,
        recovery_timeout=CIRCUIT_BREAKER_RECOVERY_TIMEOUT,
        success_threshold=CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
    )

    # 1. Circuit Breaker Fast-Fail Check
    if not await breaker.can_execute():
        reason = f"Circuit breaker is {breaker.state.value} for {service_label} - fast-failing request without network delay"
        logger.warning("[%s] %s", transaction_id, reason)
        if txn is not None:
            record_timeline(
                txn,
                event_type="CIRCUIT_BREAKER_FAST_FAIL",
                service_name=service_label,
                message=reason,
            )
        await manager.broadcast({
            "event": "CIRCUIT_BREAKER_FAST_FAIL",
            "transactionId": transaction_id,
            "service": service_label,
            "circuitState": breaker.state.value,
            "reason": reason,
        })
        raise TransactionFailedError(reason)

    last_error: Exception | None = None
    was_timeout = False

    logger.info("[%s] Calling %s at %s (Circuit: %s)", transaction_id, service_label, url, breaker.state.value)

    for attempt in range(0, MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
                response = await client.request(method, url, json=json_body)

            if response.status_code >= 500:
                raise httpx.HTTPStatusError(
                    f"{service_label} returned HTTP {response.status_code}",
                    request=response.request,
                    response=response,
                )

            response.raise_for_status()
            if attempt > 0:
                logger.info("[%s] %s succeeded on retry attempt %d", transaction_id, service_label, attempt)

            # Record success in Circuit Breaker
            await breaker.record_success()
            return response.json()

        except httpx.TimeoutException as exc:
            last_error = exc
            was_timeout = True
            logger.warning("[%s] %s timed out after %ss", transaction_id, service_label, REQUEST_TIMEOUT_SECONDS)
        except (httpx.ConnectError, httpx.HTTPStatusError, httpx.RequestError) as exc:
            last_error = exc
            logger.warning("[%s] %s failure detected: %s", transaction_id, service_label, exc)

        # Record attempt failure in Circuit Breaker
        await breaker.record_failure()

        # A failure happened on this attempt.
        if attempt == 0:
            logger.info("[%s] %s failure detected", transaction_id, service_label)
            if txn is not None:
                record_timeline(
                    txn,
                    event_type="SERVICE_FAILURE_DETECTED",
                    service_name=service_label,
                    message=f"Failure detected on {service_label}: {'Timeout' if was_timeout else last_error}",
                )
            await manager.broadcast({
                "event": "SERVICE_FAILURE_DETECTED",
                "transactionId": transaction_id,
                "service": service_label,
                "reason": "Timeout" if was_timeout else str(last_error) or "Service unavailable",
            })

        if attempt < MAX_RETRIES:
            next_attempt = attempt + 1
            logger.info("[%s] Retry attempt %d/%d for %s", transaction_id, next_attempt, MAX_RETRIES, service_label)
            if txn is not None:
                record_timeline(
                    txn,
                    event_type=f"RETRY_ATTEMPT_{next_attempt}",
                    service_name=service_label,
                    message=f"Automated retry attempt {next_attempt}/{MAX_RETRIES} for {service_label}",
                )
            await manager.broadcast({
                "event": f"RETRY_ATTEMPT_{next_attempt}",
                "transactionId": transaction_id,
                "service": service_label,
                "attempt": next_attempt,
            })
            await asyncio.sleep(RETRY_DELAY_SECONDS)

    # All attempts exhausted.
    if was_timeout:
        reason = f"{service_label} timed out after {MAX_RETRIES + 1} attempts"
    else:
        reason = f"{service_label} unavailable after {MAX_RETRIES + 1} attempts ({last_error})"

    logger.error("[%s] %s - all retry attempts exhausted", transaction_id, service_label)
    raise TransactionFailedError(reason)
