# UPI Distributed Transaction Simulator

An academic, microservice-based **UPI-style Distributed Transaction Simulator** demonstrating core Distributed Systems syllabus topics, communication paradigms, fault-tolerance patterns, message brokers, WebRTC peer-to-peer channels, and real-time telemetry.



## 🎓 Distributed Systems Syllabus Topic Mapping

### Unit I Topics & Codebase Implementation

| Syllabus Topic | Codebase Implementation & Location |
| :--- | :--- |
| **1. Definition of Distributed Systems** | Independent autonomous microservices (`Transaction Service :8000`, `Sender Bank :8001`, `NPCI Switch :8002`, `Receiver Bank :8003`) coordinating over localhost to appear as a single unified UPI payment system. |
| **2. Goals of Distributed Systems** | Demonstrates location/access transparency, high availability, fault tolerance, and openness via standard REST, gRPC, and AMQP interfaces. |
| **3. Types of Distributed Systems** | Demonstrates **Distributed Transaction Processing Systems** (centralized saga workflow) and **Peer-to-Peer Systems** (direct P2P/WebRTC node settlement). |
| **4. Distributed System Architectures** | Multi-tier Client-Server architecture (`Client App → Orchestrator → Downstream Banks`) and Decentralized P2P architecture (Phase 5 HTTP P2P & Phase 6 WebRTC DataChannel). |
| **5. Design Issues in Distributed Systems** | Addresses partial failures, network latency, concurrency, state synchronization, idempotency, and rollback without shared memory. |
| **6. Middleware** | `Uvicorn ASGI`, `gRPC HTTP/2 engine`, `RabbitMQ AMQP broker`, and `WebSocket manager` act as middleware separating business logic from transport protocols. |
| **7. Model of Distributed Computations** | Asynchronous distributed execution model with discrete state transitions, timeline records, and message passing primitives. |

### Unit II Topics & Codebase Implementation

| Syllabus Topic | Codebase Implementation & Location |
| :--- | :--- |
| **1. Communication Fundamentals** | Synchronous REST request-response (HTTP/1.1 JSON) vs asynchronous event-driven messaging. |
| **2. Remote Procedure Call (RPC)** | High-performance gRPC implementation using Protocol Buffers ([`upi.proto`](file:///c:/Users/DELL/Desktop/FA/fa/services/proto/upi.proto)), binary stubs, deadlines, and retry handling. |
| **3. Message-Oriented Communication** | Decoupled asynchronous messaging using RabbitMQ AMQP 0-9-1 with durable topic exchange (`upi.transactions`), queues, ACK/NACK, and Dead Letter Exchange (`upi.dlx`). |
| **4. Stream-Oriented Communication** | Low-latency persistent WebSocket streaming (`ws://localhost:8000/ws/transactions`) with sequence numbers, heartbeats, and replay recovery. |
| **5. P2P Messaging** | Direct inter-bank settlement (`Sender Bank :8001 → Receiver Bank :8003`) bypassing the central NPCI Switch. |
| **6. WebRTC** | Direct browser-to-browser `RTCDataChannel` payload streaming with backend WebSocket signaling broker (SDP offer/answer & ICE candidates). |
| **7. Names, Identifiers & Addresses** | Network addresses (`127.0.0.1:8000..8003`), account handles (`sanika@bank`), UUID transaction IDs, and idempotency keys (`auto-xyz`). |
| **8. Fault Tolerance** | 3-state Circuit Breaker (`CLOSED`, `OPEN`, `HALF_OPEN`), exponential backoff retries, failure/timeout injection, idempotency, and Saga compensating rollback. |

---

## 🏛️ System Architecture & Local Service Topology

The backend runs as independent Python processes directly on `localhost`:

```text
Frontend (Vite / React) :5173
       |
       | HTTP / WebSocket
       v
Transaction Service :8000 (Central Orchestrator)
       |
       +------------------------+
       |                        |
       v                        v
Sender Bank :8001       NPCI Switch :8002
(gRPC :50051)           (gRPC :50052)
                              |
                              v
                       Receiver Bank :8003
                       (gRPC :50053)
```

In **Phase 5 (Direct Peer-to-Peer)**, the NPCI Switch is bypassed:
```text
Sender Bank :8001 === Direct HTTP ===> Receiver Bank :8003
```

In **Phase 6 (WebRTC)**, backend services act only as signaling brokers, after which peers communicate directly:
```text
Browser A <========== RTCDataChannel ('upi-p2p') ==========> Browser B
```

---

## 🔌 System Services & Local Ports

| Service Name | HTTP Port | gRPC Port | Startup Command | Purpose & Role |
| :--- | :---: | :---: | :--- | :--- |
| **Transaction Service** | `:8000` | — | `cd services\transaction-service && uvicorn app.main:app --host 127.0.0.1 --port 8000` | Central orchestrator, saga state coordinator & WS push stream |
| **Sender Bank Service** | `:8001` | `:50051` | `cd services\sender-bank-service && uvicorn app.main:app --host 127.0.0.1 --port 8001` | Sender account validation, debit & compensating rollback |
| **NPCI Switch Simulator** | `:8002` | `:50052` | `cd services\npci-simulator-service && uvicorn app.main:app --host 127.0.0.1 --port 8002` | Inter-bank routing switch & centralized transaction mediator |
| **Receiver Bank Service** | `:8003` | `:50053` | `cd services\receiver-bank-service && uvicorn app.main:app --host 127.0.0.1 --port 8003` | Receiver account credit & peer-to-peer settlement endpoint |
| **RabbitMQ Broker** | `:5672` | `:15672` | Local RabbitMQ Installation / Service | AMQP message broker (durable topic exchange & DLX) |
| **Frontend UI** | `:5173` | — | `cd frontend && npm run dev` | React/Vite unified telemetry dashboard & interactive controls |

---

## 📚 7 Completed Academic Phases & Communication Paradigms

1. **Phase 1 — Distributed Systems Fault Tolerance**:
   Synchronous REST (HTTP/1.1 JSON) with 3-state Circuit Breaker (`CLOSED`, `OPEN`, `HALF_OPEN`), configurable failure injection, exponential backoff retries, and Saga compensating rollbacks.
2. **Phase 2 — Remote Procedure Call (RPC)**:
   High-performance binary RPC using gRPC & Protocol Buffers (`upi.proto`) over HTTP/2 with deadlines and retry handling.
3. **Phase 3 — Message-Oriented Communication**:
   Decoupled asynchronous messaging using RabbitMQ (AMQP 0-9-1) with durable topic exchange (`upi.transactions`), queue workers, acknowledgements, retries, and Dead Letter Exchange (`upi.dlx`).
4. **Phase 4 — Stream-Oriented Communication**:
   Low-latency persistent WebSocket streaming (`ws://localhost:8000/ws/transactions`) with monotonic sequence numbers, heartbeats, and replay recovery ring buffer.
5. **Phase 5 — Direct Peer-to-Peer (P2P) Messaging**:
   Direct inter-bank settlement (`Sender Bank → Receiver Bank`) via HTTP peer endpoints, completely bypassing the NPCI Switch.
6. **Phase 6 — WebRTC Peer-to-Peer DataChannel**:
   Direct browser-to-browser SCTP/DTLS `RTCDataChannel` payload transmission with backend signaling broker (SDP/ICE candidate exchange).
7. **Phase 7 — Monitoring & Unified Telemetry Dashboard**:
   Unified dashboard displaying real-time metrics, service health, protocol comparison matrix, circuit breaker status, and topology visualizations.

---

## 🚀 Local Setup & Execution Guide

### 1. Prerequisites
- **Python 3.11+**
- **Node.js 18+**
- **RabbitMQ Server** (running locally on `localhost:5672` for Phase 3 AMQP broker)

### 2. Install Python Dependencies
```powershell
pip install -r requirements.txt
```

### 3. Local Startup Instructions (Terminals 1 to 5)

#### Terminal 1 — Transaction Service
```powershell
cd services\transaction-service
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

#### Terminal 2 — Sender Bank Service
```powershell
cd services\sender-bank-service
uvicorn app.main:app --host 127.0.0.1 --port 8001
```

#### Terminal 3 — NPCI Switch Simulator
```powershell
cd services\npci-simulator-service
uvicorn app.main:app --host 127.0.0.1 --port 8002
```

#### Terminal 4 — Receiver Bank Service
```powershell
cd services\receiver-bank-service
uvicorn app.main:app --host 127.0.0.1 --port 8003
```

#### Terminal 5 — Frontend Application
```powershell
cd frontend
npm install
npm run dev
```

Or start all services automatically via PowerShell:
```powershell
.\run_all.ps1
```

Open `http://localhost:5173` in your browser.

---

## 🧪 Automated Testing & Verification

Run individual phase test suites:
```powershell
python test_phase1.py
python test_phase2.py
python test_phase3.py
python test_phase4.py
python test_phase5.py
python test_phase6.py
python test_phase7.py
```

Or run the full regression test suite via `pytest`:
```powershell
python -m pytest -q test_phase1.py test_phase2.py test_phase3.py test_phase4.py test_phase5.py test_phase6.py test_phase7.py
```

### ⚠️ WebRTC Manual Verification Note
Automated test `test_phase6.py` verifies signaling, room management, SDP/ICE broker routing, and peer connection lifecycle on the backend. Actual browser-to-browser `RTCDataChannel` payload transfer must be verified manually by opening two separate browser windows/tabs at `http://localhost:5173`.
