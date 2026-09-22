import sys
from pathlib import Path

# Ensure proto directory is in sys.path so generated upi_pb2_grpc can import upi_pb2 directly
PROTO_DIR = str(Path(__file__).resolve().parent)
if PROTO_DIR not in sys.path:
    sys.path.insert(0, PROTO_DIR)
