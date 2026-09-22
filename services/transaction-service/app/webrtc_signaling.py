"""
WebRTC Signaling Server Manager for Phase 6.
Handles WebSockets signaling (/ws/webrtc) for browser-to-browser WebRTC session negotiation.

The backend acts STRICTLY as a signaling server (broker for SDP offers/answers and ICE candidates).
The actual transaction data payload is transmitted directly between browser peers over an RTCDataChannel.
"""

import asyncio
import json
import logging
from typing import Dict, List, Tuple, Optional
from fastapi import WebSocket

logger = logging.getLogger("transaction-service.webrtc")


class WebRTCSignalingManager:
    def __init__(self):
        # roomId -> {peerId -> WebSocket}
        self._rooms: Dict[str, Dict[str, WebSocket]] = {}
        # websocket -> (roomId, peerId)
        self._peer_meta: Dict[WebSocket, Tuple[str, str]] = {}
        self._lock = asyncio.Lock()

    async def connect_peer(self, websocket: WebSocket, room_id: str, peer_id: str) -> bool:
        """
        Registers a peer in a signaling room.
        Returns True if successful, False if peerId is already in use in that room.
        """
        async with self._lock:
            if room_id not in self._rooms:
                self._rooms[room_id] = {}

            if peer_id in self._rooms[room_id]:
                logger.warning("[WebRTC Signaling] Rejecting duplicate peerId '%s' in room '%s'", peer_id, room_id)
                return False

            self._rooms[room_id][peer_id] = websocket
            self._peer_meta[websocket] = (room_id, peer_id)
            logger.info("[WebRTC Signaling] Peer '%s' joined room '%s' (%d peers in room)",
                        peer_id, room_id, len(self._rooms[room_id]))
            return True

    async def disconnect_socket(self, websocket: WebSocket) -> Optional[Tuple[str, str]]:
        """
        Removes a peer socket and notifies remaining room members.
        Returns (room_id, peer_id) if found.
        """
        async with self._lock:
            meta = self._peer_meta.pop(websocket, None)
            if not meta:
                return None

            room_id, peer_id = meta
            if room_id in self._rooms:
                self._rooms[room_id].pop(peer_id, None)
                remaining_peers = list(self._rooms[room_id].keys())

                logger.info("[WebRTC Signaling] Peer '%s' left room '%s' (%d remaining)",
                            peer_id, room_id, len(remaining_peers))

                # Notify remaining peers
                notify_msg = {
                    "type": "peer-left",
                    "roomId": room_id,
                    "peerId": peer_id,
                    "peers": remaining_peers,
                }
                for target_peer, target_ws in list(self._rooms[room_id].items()):
                    try:
                        await target_ws.send_json(notify_msg)
                    except Exception:
                        pass

                if not self._rooms[room_id]:
                    del self._rooms[room_id]
                    logger.info("[WebRTC Signaling] Room '%s' is now empty and cleaned up", room_id)

            return (room_id, peer_id)

    async def route_signaling_message(self, sender_ws: WebSocket, payload: dict):
        """
        Routes WebRTC signaling messages (offer, answer, ice-candidate, leave)
        between peers in the same room.
        """
        meta = self._peer_meta.get(sender_ws)
        if not meta:
            logger.warning("[WebRTC Signaling] Received message from unregistered socket")
            return

        room_id, sender_peer_id = meta
        msg_type = payload.get("type") or payload.get("action")
        target_peer_id = payload.get("targetPeerId")

        async with self._lock:
            room_peers = self._rooms.get(room_id, {})
            if not room_peers:
                return

            # Construct forwarded message
            forward_payload = {
                **payload,
                "roomId": room_id,
                "peerId": sender_peer_id,
            }

            if target_peer_id and target_peer_id in room_peers:
                # Direct message to target peer
                target_ws = room_peers[target_peer_id]
                try:
                    await target_ws.send_json(forward_payload)
                except Exception as exc:
                    logger.warning("[WebRTC Signaling] Failed sending signaling message to %s: %s", target_peer_id, exc)
            else:
                # Broadcast to all other peers in the room
                for pid, target_ws in room_peers.items():
                    if pid != sender_peer_id:
                        try:
                            await target_ws.send_json(forward_payload)
                        except Exception as exc:
                            logger.warning("[WebRTC Signaling] Failed broadcasting signaling message to %s: %s", pid, exc)

    def get_room_peers(self, room_id: str) -> List[str]:
        return list(self._rooms.get(room_id, {}).keys())

    def get_all_rooms(self) -> Dict[str, List[str]]:
        return {rid: list(peers.keys()) for rid, peers in self._rooms.items()}


webrtc_manager = WebRTCSignalingManager()
