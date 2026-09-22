"""
Message-Oriented Communication Module for UPI Simulator (Phase 3).
Provides RabbitMQ / AMQP message broker integration using aio-pika with fallback
to an in-memory mock broker for standalone CLI execution environments.
"""

import asyncio
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Callable, Dict, Any, Optional, List, Awaitable

try:
    import aio_pika
    from aio_pika import ExchangeType, Message, DeliveryMode
    HAS_AIO_PIKA = True
except ImportError:
    HAS_AIO_PIKA = False

logger = logging.getLogger("messaging")

# Standard Exchange and Queue Constants
EXCHANGE_NAME = "upi.transactions"
DLX_NAME = "upi.dlx"
DLQ_NAME = "q.upi.dlq"

QUEUE_DEBIT = "q.sender.debit"
QUEUE_ROUTE = "q.npci.route"
QUEUE_CREDIT = "q.receiver.credit"
QUEUE_ROLLBACK = "q.sender.rollback"

ROUTING_KEY_DEBIT = "transaction.debit"
ROUTING_KEY_ROUTE = "transaction.route"
ROUTING_KEY_CREDIT = "transaction.credit"
ROUTING_KEY_ROLLBACK = "transaction.rollback"

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")


def create_event_payload(
    transaction_id: str,
    event_type: str,
    sender_id: str = "",
    receiver_id: str = "",
    sender_bank: str = "sender-bank-service",
    receiver_bank: str = "receiver-bank-service",
    amount: float = 0.0,
    status: str = "PROCESSING",
    retry_count: int = 0,
    error: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload = {
        "messageId": str(uuid.uuid4()),
        "transactionId": transaction_id,
        "eventType": event_type,
        "senderId": sender_id,
        "receiverId": receiver_id,
        "senderBank": sender_bank,
        "receiverBank": receiver_bank,
        "amount": amount,
        "status": status,
        "retryCount": retry_count,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "error": error,
    }
    if extra:
        payload.update(extra)
    return payload


class MockMessage:
    def __init__(self, body: bytes, routing_key: str, headers: Optional[Dict[str, Any]] = None):
        self.body = body
        self.routing_key = routing_key
        self.headers = headers or {}
        self.acked = False
        self.nacked = False
        self.requeued = False

    async def ack(self):
        self.acked = True

    async def nack(self, requeue: bool = False):
        self.nacked = True
        self.requeued = requeue


class MockQueue:
    def __init__(self, name: str):
        self.name = name
        self._queue: asyncio.Queue = asyncio.Queue()

    async def put(self, msg: MockMessage):
        await self._queue.put(msg)

    async def get(self) -> MockMessage:
        return await self._queue.get()

    def qsize(self) -> int:
        return self._queue.qsize()


class MockBroker:
    def __init__(self):
        self.queues: Dict[str, MockQueue] = {
            QUEUE_DEBIT: MockQueue(QUEUE_DEBIT),
            QUEUE_ROUTE: MockQueue(QUEUE_ROUTE),
            QUEUE_CREDIT: MockQueue(QUEUE_CREDIT),
            QUEUE_ROLLBACK: MockQueue(QUEUE_ROLLBACK),
            DLQ_NAME: MockQueue(DLQ_NAME),
        }
        self.bindings: Dict[str, str] = {
            ROUTING_KEY_DEBIT: QUEUE_DEBIT,
            ROUTING_KEY_ROUTE: QUEUE_ROUTE,
            ROUTING_KEY_CREDIT: QUEUE_CREDIT,
            ROUTING_KEY_ROLLBACK: QUEUE_ROLLBACK,
        }
        self.dlq_messages: List[Dict[str, Any]] = []
        self.published_messages: List[Dict[str, Any]] = []

    async def publish(self, exchange: str, routing_key: str, payload: Dict[str, Any], headers: Optional[Dict[str, Any]] = None):
        body = json.dumps(payload).encode("utf-8")
        msg = MockMessage(body, routing_key, headers)
        self.published_messages.append({"exchange": exchange, "routing_key": routing_key, "payload": payload})
        
        target_queue = self.bindings.get(routing_key)
        if target_queue and target_queue in self.queues:
            await self.queues[target_queue].put(msg)
        elif exchange == DLX_NAME or routing_key == "dlq":
            await self.queues[DLQ_NAME].put(msg)
            self.dlq_messages.append(payload)

    async def route_to_dlq(self, payload: Dict[str, Any], reason: str = ""):
        payload_copy = dict(payload)
        payload_copy["dlq_reason"] = reason
        self.dlq_messages.append(payload_copy)
        body = json.dumps(payload_copy).encode("utf-8")
        msg = MockMessage(body, "dlq", {"x-dead-letter-reason": reason})
        await self.queues[DLQ_NAME].put(msg)


class MessageBroker:
    def __init__(self, url: str = RABBITMQ_URL):
        self.url = url
        self.connection = None
        self.channel = None
        self.exchange = None
        self.dlx_exchange = None
        self.queues: Dict[str, Any] = {}
        self.is_connected = False
        self.use_mock = False
        self.mock_broker = MockBroker()
        self._consumer_tasks: List[asyncio.Task] = []

    async def connect(self, force_mock: bool = False) -> bool:
        if force_mock or os.getenv("FORCE_MOCK_MQ", "0") == "1":
            self.use_mock = True
            self.is_connected = True
            logger.info("[MQ] Initialized in MOCK BROKER mode.")
            return True

        if HAS_AIO_PIKA:
            try:
                self.connection = await aio_pika.connect_robust(self.url, timeout=2.0)
                self.channel = await self.connection.channel()
                await self.channel.set_qos(prefetch_count=10)

                # Declare Exchange
                self.exchange = await self.channel.declare_exchange(
                    EXCHANGE_NAME, ExchangeType.TOPIC, durable=True
                )

                # Declare Main Queues
                queue_configs = [
                    (QUEUE_DEBIT, ROUTING_KEY_DEBIT),
                    (QUEUE_ROUTE, ROUTING_KEY_ROUTE),
                    (QUEUE_CREDIT, ROUTING_KEY_CREDIT),
                    (QUEUE_ROLLBACK, ROUTING_KEY_ROLLBACK),
                ]

                for qname, rkey in queue_configs:
                    q = await self.channel.declare_queue(qname, durable=True)
                    await q.bind(self.exchange, routing_key=rkey)
                    self.queues[qname] = q

                self.is_connected = True
                self.use_mock = False
                logger.info("[MQ] Successfully connected to RabbitMQ broker at %s", self.url)
                return True
            except Exception as exc:
                logger.warning("[MQ] Could not connect to RabbitMQ broker (%s). Falling back to Mock Broker.", exc)

        self.use_mock = True
        self.is_connected = True
        logger.info("[MQ] Initialized in MOCK BROKER fallback mode.")
        return True

    async def publish(self, routing_key: str, payload: Dict[str, Any], headers: Optional[Dict[str, Any]] = None):
        if self.use_mock:
            await self.mock_broker.publish(EXCHANGE_NAME, routing_key, payload, headers)
            return

        body = json.dumps(payload).encode("utf-8")
        msg = Message(
            body=body,
            content_type="application/json",
            delivery_mode=DeliveryMode.PERSISTENT,
            headers=headers or {},
        )
        await self.exchange.publish(msg, routing_key=routing_key)
        logger.info("[MQ] Published event %s with key %s (txn=%s)", payload.get("eventType"), routing_key, payload.get("transactionId"))

    async def start_consumer(self, queue_name: str, callback: Callable[[Dict[str, Any], Any], Awaitable[None]]):
        if self.use_mock:
            async def _mock_loop():
                q = self.mock_broker.queues[queue_name]
                while True:
                    try:
                        msg = await q.get()
                        payload = json.loads(msg.body.decode("utf-8"))
                        try:
                            await callback(payload, msg)
                            if not msg.acked and not msg.nacked:
                                await msg.ack()
                        except Exception as exc:
                            logger.error("[MQ] Consumer error on queue %s: %s", queue_name, exc)
                            if not msg.acked and not msg.nacked:
                                await msg.nack(requeue=False)
                                await self.mock_broker.route_to_dlq(payload, str(exc))
                    except asyncio.CancelledError:
                        break
                    except Exception as e:
                        logger.error("[MQ] Mock consumer error: %s", e)

            task = asyncio.create_task(_mock_loop())
            self._consumer_tasks.append(task)
            return task
        else:
            q = self.queues.get(queue_name)
            if not q:
                raise ValueError(f"Queue {queue_name} not found")

            async def _on_message(msg: aio_pika.IncomingMessage):
                async with msg.process(ignore_processed=True):
                    try:
                        payload = json.loads(msg.body.decode("utf-8"))
                        await callback(payload, msg)
                        await msg.ack()
                    except Exception as exc:
                        logger.error("[MQ] Error processing message on %s: %s", queue_name, exc)
                        await msg.nack(requeue=False)

            consumer_tag = await q.consume(_on_message)
            return consumer_tag

    async def close(self):
        for task in self._consumer_tasks:
            task.cancel()
        if self.connection and not self.connection.is_closed:
            await self.connection.close()
        self.is_connected = False


# Global Singleton Broker Instance
broker = MessageBroker()
