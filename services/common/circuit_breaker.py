"""
Circuit Breaker Implementation for Distributed Systems Fault Tolerance.

Implements the 3-state Circuit Breaker pattern:
CLOSED -> (repeated failures >= threshold) -> OPEN
OPEN -> (recovery timeout elapsed) -> HALF_OPEN
HALF_OPEN -> (trial request succeeds) -> CLOSED
HALF_OPEN -> (trial request fails) -> OPEN
"""
import asyncio
from datetime import datetime, timezone
from enum import Enum
import logging
import os
from typing import Callable, Awaitable, Dict, Any, Optional, Union

logger = logging.getLogger("circuit-breaker")


class CircuitState(str, Enum):
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


# Configurable defaults from environment variables or sensible fallbacks
DEFAULT_FAILURE_THRESHOLD = int(os.getenv("CIRCUIT_BREAKER_FAILURE_THRESHOLD", "3"))
DEFAULT_RECOVERY_TIMEOUT = float(os.getenv("CIRCUIT_BREAKER_RECOVERY_TIMEOUT", "10.0"))
DEFAULT_SUCCESS_THRESHOLD = int(os.getenv("CIRCUIT_BREAKER_SUCCESS_THRESHOLD", "1"))


StateChangeCallback = Callable[[str, CircuitState, CircuitState, str], Union[None, Awaitable[None]]]


class CircuitBreaker:
    """
    Manages failure tracking and state transitions for a single downstream service.
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = DEFAULT_FAILURE_THRESHOLD,
        recovery_timeout: float = DEFAULT_RECOVERY_TIMEOUT,
        success_threshold: int = DEFAULT_SUCCESS_THRESHOLD,
        on_state_change: Optional[StateChangeCallback] = None,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.success_threshold = success_threshold
        self.on_state_change = on_state_change

        self._state: CircuitState = CircuitState.CLOSED
        self._failure_count: int = 0
        self._consecutive_successes: int = 0
        self._last_state_change: datetime = datetime.now(timezone.utc)
        self._lock = asyncio.Lock()

    @property
    def state(self) -> CircuitState:
        """Returns the current state, dynamically evaluating if OPEN timeout has elapsed."""
        if self._state == CircuitState.OPEN:
            elapsed = (datetime.now(timezone.utc) - self._last_state_change).total_seconds()
            if elapsed >= self.recovery_timeout:
                return CircuitState.HALF_OPEN
        return self._state

    async def can_execute(self) -> bool:
        """
        Determines whether a request to the downstream service should be allowed.
        Returns True for CLOSED and HALF_OPEN.
        Returns False for OPEN (if recovery timeout has not elapsed).
        """
        async with self._lock:
            current = self.state
            if current == CircuitState.HALF_OPEN and self._state == CircuitState.OPEN:
                await self._set_state(
                    CircuitState.HALF_OPEN,
                    reason=f"Recovery timeout ({self.recovery_timeout}s) elapsed. Entering trial state.",
                )
                return True
            elif self._state == CircuitState.OPEN:
                return False
            return True

    async def record_success(self):
        """
        Records a successful downstream request.
        Resets failure count if CLOSED, or transitions HALF_OPEN -> CLOSED if success threshold reached.
        """
        async with self._lock:
            current = self.state
            if current == CircuitState.HALF_OPEN or self._state == CircuitState.HALF_OPEN:
                self._consecutive_successes += 1
                if self._consecutive_successes >= self.success_threshold:
                    self._failure_count = 0
                    self._consecutive_successes = 0
                    await self._set_state(
                        CircuitState.CLOSED,
                        reason=f"Trial request succeeded ({self.success_threshold} success). Service recovered.",
                    )
            elif self._state == CircuitState.CLOSED:
                self._failure_count = 0

    async def record_failure(self):
        """
        Records a failed downstream request attempt.
        Increments failure count if CLOSED, transitioning to OPEN if threshold reached.
        Transitions directly back to OPEN if HALF_OPEN or OPEN.
        """
        async with self._lock:
            current = self.state
            if current == CircuitState.HALF_OPEN or self._state == CircuitState.HALF_OPEN:
                self._failure_count = self.failure_threshold
                self._consecutive_successes = 0
                await self._set_state(
                    CircuitState.OPEN,
                    reason="Trial request failed in HALF_OPEN state. Re-opening circuit.",
                )
            elif self._state == CircuitState.CLOSED:
                self._failure_count += 1
                if self._failure_count >= self.failure_threshold:
                    await self._set_state(
                        CircuitState.OPEN,
                        reason=f"Failure threshold ({self.failure_threshold}) reached. Circuit opened.",
                    )

    async def _set_state(self, new_state: CircuitState, reason: str = ""):
        old_state = self._state
        if old_state == new_state:
            return
        self._state = new_state
        self._last_state_change = datetime.now(timezone.utc)
        logger.warning(
            "[%s] Circuit Breaker state change: %s -> %s (%s)",
            self.name,
            old_state.value if hasattr(old_state, "value") else str(old_state),
            new_state.value if hasattr(new_state, "value") else str(new_state),
            reason,
        )
        if self.on_state_change:
            try:
                res = self.on_state_change(self.name, old_state, new_state, reason)
                if asyncio.iscoroutine(res):
                    await res
            except Exception as exc:
                logger.error("[%s] Error in state change callback: %s", self.name, exc)

    async def reset(self):
        """Resets the breaker back to CLOSED state manually."""
        async with self._lock:
            self._failure_count = 0
            self._consecutive_successes = 0
            await self._set_state(CircuitState.CLOSED, reason="Manual reset triggered")

    def get_status_dict(self) -> Dict[str, Any]:
        """Returns a serializable status dictionary."""
        current_state = self.state  # triggers evaluation if OPEN & timeout expired
        return {
            "name": self.name,
            "state": current_state.value,
            "failureCount": self._failure_count,
            "failureThreshold": self.failure_threshold,
            "recoveryTimeout": self.recovery_timeout,
            "successThreshold": self.success_threshold,
            "lastStateChange": self._last_state_change.isoformat(),
        }


class CircuitBreakerRegistry:
    """
    Registry of Circuit Breaker instances per downstream service.
    """

    def __init__(self):
        self._breakers: Dict[str, CircuitBreaker] = {}
        self._on_state_change_callback: Optional[StateChangeCallback] = None

    def set_on_state_change_callback(self, callback: StateChangeCallback):
        self._on_state_change_callback = callback
        for cb in self._breakers.values():
            cb.on_state_change = callback

    def get_breaker(
        self,
        name: str,
        failure_threshold: int = DEFAULT_FAILURE_THRESHOLD,
        recovery_timeout: float = DEFAULT_RECOVERY_TIMEOUT,
        success_threshold: int = DEFAULT_SUCCESS_THRESHOLD,
    ) -> CircuitBreaker:
        if name not in self._breakers:
            self._breakers[name] = CircuitBreaker(
                name=name,
                failure_threshold=failure_threshold,
                recovery_timeout=recovery_timeout,
                success_threshold=success_threshold,
                on_state_change=self._on_state_change_callback,
            )
        return self._breakers[name]

    def get_all_statuses(self) -> Dict[str, Dict[str, Any]]:
        return {name: cb.get_status_dict() for name, cb in self._breakers.items()}

    async def reset_all(self):
        for cb in self._breakers.values():
            await cb.reset()


# Global registry instance
circuit_breaker_registry = CircuitBreakerRegistry()
