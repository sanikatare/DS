"""
Configuration constants for the transaction service.

Default configuration targets independent local microservice ports on localhost.
Can be overridden via environment variables if desired.
"""
import os
import sys
from pathlib import Path

# Ensure services directory is in sys.path for cross-module imports
SERVICES_DIR = str(Path(__file__).resolve().parent.parent.parent)
if SERVICES_DIR not in sys.path:
    sys.path.insert(0, SERVICES_DIR)

SENDER_BANK_URL = os.getenv("SENDER_BANK_URL", "http://localhost:8001")
NPCI_URL = os.getenv("NPCI_URL", "http://localhost:8002")
RECEIVER_BANK_URL = os.getenv("RECEIVER_BANK_URL", "http://localhost:8003")

# Fault tolerance: retry and timeout configuration
REQUEST_TIMEOUT_SECONDS = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "3"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "2"))
RETRY_DELAY_SECONDS = float(os.getenv("RETRY_DELAY_SECONDS", "1"))

# Circuit Breaker configuration
CIRCUIT_BREAKER_FAILURE_THRESHOLD = int(os.getenv("CIRCUIT_BREAKER_FAILURE_THRESHOLD", "3"))
CIRCUIT_BREAKER_RECOVERY_TIMEOUT = float(os.getenv("CIRCUIT_BREAKER_RECOVERY_TIMEOUT", "10.0"))
CIRCUIT_BREAKER_SUCCESS_THRESHOLD = int(os.getenv("CIRCUIT_BREAKER_SUCCESS_THRESHOLD", "1"))

SENDER_BANK_GRPC_URL = os.getenv("SENDER_BANK_GRPC_URL", "localhost:50051")
NPCI_GRPC_URL = os.getenv("NPCI_GRPC_URL", "localhost:50052")
RECEIVER_BANK_GRPC_URL = os.getenv("RECEIVER_BANK_GRPC_URL", "localhost:50053")

# Message Broker Configuration
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")

# Communication Mode: "rest" (default), "grpc", "rabbitmq", or "p2p"
COMMUNICATION_MODE = os.getenv("COMMUNICATION_MODE", "rest").lower()
RECEIVER_BANK_PEER_URL = os.getenv("RECEIVER_BANK_PEER_URL", "http://localhost:8003")

FAILURE_TARGETS = {
    "sender-bank": SENDER_BANK_URL,
    "npci": NPCI_URL,
    "receiver-bank": RECEIVER_BANK_URL,
}
