"""
RabbitMQ Producer Helper for Transaction Service (Phase 3).
Publishes asynchronous events to RabbitMQ topic exchange.
"""

import logging
from typing import Dict, Any
from common.messaging import (
    broker,
    create_event_payload,
    ROUTING_KEY_DEBIT,
    ROUTING_KEY_ROUTE,
    ROUTING_KEY_CREDIT,
    ROUTING_KEY_ROLLBACK,
)

logger = logging.getLogger("transaction-service.mq_producer")


async def publish_debit_request(txn: Dict[str, Any]) -> Dict[str, Any]:
    payload = create_event_payload(
        transaction_id=txn["transactionId"],
        event_type="DEBIT_REQUEST",
        sender_id=txn.get("senderId", ""),
        receiver_id=txn.get("receiverId", ""),
        amount=float(txn.get("amount", 0.0)),
        status="PROCESSING",
    )
    if not broker.is_connected:
        await broker.connect()
    await broker.publish(ROUTING_KEY_DEBIT, payload)
    logger.info("[%s] Published DEBIT_REQUEST event over MQ", txn["transactionId"])
    return payload


async def publish_route_request(txn: Dict[str, Any]) -> Dict[str, Any]:
    payload = create_event_payload(
        transaction_id=txn["transactionId"],
        event_type="ROUTE_REQUEST",
        sender_id=txn.get("senderId", ""),
        receiver_id=txn.get("receiverId", ""),
        amount=float(txn.get("amount", 0.0)),
        status="PROCESSING",
    )
    if not broker.is_connected:
        await broker.connect()
    await broker.publish(ROUTING_KEY_ROUTE, payload)
    logger.info("[%s] Published ROUTE_REQUEST event over MQ", txn["transactionId"])
    return payload


async def publish_credit_request(txn: Dict[str, Any]) -> Dict[str, Any]:
    payload = create_event_payload(
        transaction_id=txn["transactionId"],
        event_type="CREDIT_REQUEST",
        sender_id=txn.get("senderId", ""),
        receiver_id=txn.get("receiverId", ""),
        amount=float(txn.get("amount", 0.0)),
        status="PROCESSING",
    )
    if not broker.is_connected:
        await broker.connect()
    await broker.publish(ROUTING_KEY_CREDIT, payload)
    logger.info("[%s] Published CREDIT_REQUEST event over MQ", txn["transactionId"])
    return payload


async def publish_rollback_request(txn: Dict[str, Any], reason: str = "") -> Dict[str, Any]:
    payload = create_event_payload(
        transaction_id=txn["transactionId"],
        event_type="ROLLBACK_REQUEST",
        sender_id=txn.get("senderId", ""),
        receiver_id=txn.get("receiverId", ""),
        amount=float(txn.get("amount", 0.0)),
        status="ROLLBACK_INITIATED",
        error=reason,
    )
    if not broker.is_connected:
        await broker.connect()
    await broker.publish(ROUTING_KEY_ROLLBACK, payload)
    logger.info("[%s] Published ROLLBACK_REQUEST event over MQ", txn["transactionId"])
    return payload
