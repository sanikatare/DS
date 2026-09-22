"""
WebSocket connection manager for real-time transaction event streams.
Implements stream-oriented communication (Phase 4):
- Monotonically increasing sequence numbers
- Structured event schema (eventId, sequence, transactionId, eventType, timestamp, source, status, payload)
- In-memory bounded replay buffer for missed-event recovery
- Heartbeat / ping-pong handling and connection health tracking
- Multi-client isolation and broadcast
"""

import asyncio
import json
import logging
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from fastapi import WebSocket

logger = logging.getLogger("transaction-service.ws")

MAX_STREAM_BUFFER_SIZE = 500


class ConnectionManager:
    def __init__(self, max_buffer_size: int = MAX_STREAM_BUFFER_SIZE):
        self._connections: List[WebSocket] = []
        self._client_metadata: Dict[WebSocket, Dict[str, Any]] = {}
        self._sequence_counter: int = 0
        self._buffer: deque = deque(maxlen=max_buffer_size)
        self._lock = asyncio.Lock()

    @property
    def current_sequence(self) -> int:
        return self._sequence_counter

    def next_sequence(self) -> int:
        self._sequence_counter += 1
        return self._sequence_counter

    async def connect(self, websocket: WebSocket, client_id: Optional[str] = None):
        await websocket.accept()
        cid = client_id or f"client-{uuid.uuid4().hex[:6]}"
        self._connections.append(websocket)
        self._client_metadata[websocket] = {
            "id": cid,
            "connected_at": datetime.now(timezone.utc).isoformat(),
            "last_ping": datetime.now(timezone.utc).isoformat(),
            "reconnect_count": 0,
        }
        logger.info("[WS] Client connected: %s (%d total connected)", cid, len(self._connections))

    def disconnect(self, websocket: WebSocket):
        if websocket in self._connections:
            self._connections.remove(websocket)
        meta = self._client_metadata.pop(websocket, {})
        cid = meta.get("id", "unknown")
        logger.info("[WS] Client disconnected: %s (%d total connected)", cid, len(self._connections))

    async def handle_ping(self, websocket: WebSocket):
        meta = self._client_metadata.get(websocket)
        if meta:
            meta["last_ping"] = datetime.now(timezone.utc).isoformat()
        try:
            await websocket.send_json({
                "event": "PONG",
                "eventType": "PONG",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "sequence": self._sequence_counter,
            })
        except Exception as exc:
            logger.warning("[WS] Error sending PONG to client: %s", exc)
            self.disconnect(websocket)

    async def replay_missed_events(self, websocket: WebSocket, last_sequence: int) -> int:
        """
        Replays buffered events with sequence > last_sequence to the reconnected client.
        Returns count of replayed events.
        """
        if last_sequence <= 0 or not self._buffer:
            return 0

        replayed_count = 0
        min_buffered_seq = self._buffer[0].get("sequence", 0)

        if last_sequence < min_buffered_seq - 1:
            logger.warning(
                "[WS] Client requested sequence %d, but oldest buffered sequence is %d (buffer miss)",
                last_sequence, min_buffered_seq
            )
            try:
                await websocket.send_json({
                    "event": "STREAM_MISSED_RECOVERY_EXPIRED",
                    "eventType": "STREAM_MISSED_RECOVERY_EXPIRED",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "message": f"Requested sequence {last_sequence} is older than replay buffer (min seq: {min_buffered_seq})",
                    "sequence": self._sequence_counter,
                })
            except Exception:
                pass
            return 0

        for event in list(self._buffer):
            if event.get("sequence", 0) > last_sequence:
                try:
                    await websocket.send_json(event)
                    replayed_count += 1
                except Exception:
                    self.disconnect(websocket)
                    break

        logger.info(
            "[WS] Replayed %d missed events to client (lastSequence=%d -> latest=%d)",
            replayed_count, last_sequence, self._sequence_counter
        )
        return replayed_count

    async def broadcast(self, raw_event: dict):
        """
        Formats, sequences, buffers, and broadcasts an event dict to all connected WebSocket clients.
        """
        async with self._lock:
            seq = self.next_sequence()
            timestamp = datetime.now(timezone.utc).isoformat()
            event_id = f"EVT-{uuid.uuid4().hex[:8].upper()}"

            formatted_event = {
                "eventId": event_id,
                "sequence": seq,
                "transactionId": raw_event.get("transactionId") or raw_event.get("txnId") or "SYS-GLOBAL",
                "eventType": raw_event.get("event") or raw_event.get("eventType") or "GENERIC_SIGNAL",
                "event": raw_event.get("event") or raw_event.get("eventType") or "GENERIC_SIGNAL",
                "timestamp": timestamp,
                "source": raw_event.get("service") or raw_event.get("source") or "transaction-service",
                "service": raw_event.get("service") or raw_event.get("source") or "transaction-service",
                "status": raw_event.get("status") or "PROCESSING",
                "message": raw_event.get("message") or raw_event.get("reason") or raw_event.get("event") or "",
                **raw_event,
                "payload": raw_event,
            }

            self._buffer.append(formatted_event)

        logger.info(
            "[WS] Event streamed seq=%d eventId=%s eventType=%s (clients=%d)",
            seq, event_id, formatted_event["eventType"], len(self._connections)
        )

        dead = []
        for ws in list(self._connections):
            try:
                await ws.send_json(formatted_event)
            except Exception as exc:
                logger.warning("[WS] Error sending event to client, marking dead: %s", exc)
                dead.append(ws)

        for ws in dead:
            self.disconnect(ws)

        return formatted_event

    def get_stream_stats(self) -> dict:
        return {
            "activeClients": len(self._connections),
            "totalSequence": self._sequence_counter,
            "bufferedEvents": len(self._buffer),
            "maxBufferSize": self._buffer.maxlen,
        }


manager = ConnectionManager()
