# UPI Distributed Transaction Simulator

An interactive educational simulator for understanding distributed systems through a UPI-inspired payment workflow. The project demonstrates how independent banking services coordinate transactions, communicate through multiple protocols, recover from failures, and maintain consistency across distributed nodes.

> **Educational project:** This simulator does not connect to real UPI, NPCI, banks, payment networks, or production financial systems.

## Overview

The application provides a React-based dashboard backed by an Express and WebSocket server. It simulates a transaction moving through a sender bank, an NPCI-style interbank switch, and a receiver bank while visualizing distributed-systems concepts in real time.

The simulator includes:

- UPI-style transaction orchestration
- Sender debit and receiver credit processing
- NPCI interbank routing simulation
- REST, gRPC, RabbitMQ, WebSocket, P2P, and WebRTC communication models
- Retry handling and request timeouts
- Three-state circuit breakers
- Compensating Saga rollbacks
- Idempotency protection against duplicate requests
- Lamport logical clocks
- Vector clocks and causal-order comparisons
- Berkeley-style physical clock synchronization
- Chandy-Lamport global-state snapshots
- Beacon-based failure detection
- Bully and Ring election algorithms
- Distributed mutual exclusion using Ricart-Agrawala-style coordination
- Double-entry ledger and conservation checks
- Fault injection for bank, NPCI, and timeout failures

## Architecture

```text
React SPA / Vite Dashboard
          |
          | REST API + WebSocket + WebRTC signaling
          v
Express Transaction Orchestrator
          |
          +-- Sender Bank Service simulator
          +-- NPCI Interbank Switch simulator
          +-- Receiver Bank Service simulator
          |
          +-- Circuit Breakers
          +-- Retry and Timeout Engine
          +-- Saga Rollback Coordinator
          +-- Synchronization Algorithms
          +-- In-Memory Transaction and Ledger State
```

### Transaction flow

1. The client submits a transaction with sender, receiver, amount, mode, and an optional idempotency key.
2. The transaction service validates the request and prevents duplicate processing.
3. The sender bank validates the account and performs an atomic debit.
4. The NPCI simulator routes the transaction for standard REST, gRPC, or RabbitMQ flows.
5. The receiver bank credits the beneficiary account.
6. The transaction service marks the payment as successful and broadcasts timeline events.
7. If a downstream step fails, the sender debit is compensated through a Saga rollback.

For P2P mode, the sender bank communicates directly with the receiver bank and bypasses the NPCI simulator.

## Technology Stack

- **Frontend:** React 18, React Router, Lucide React, CSS
- **Build tool:** Vite 6
- **Backend:** Node.js, Express, TypeScript
- **Real-time communication:** WebSocket (`ws`), WebRTC signaling
- **Protocols modeled:** REST/HTTP, gRPC/HTTP/2, RabbitMQ AMQP, WebSocket, P2P HTTP, WebRTC DataChannel
- **State:** In-memory maps for users, transactions, balances, events, and synchronization state
- **Testing:** TypeScript test runner using `tsx`

## Requirements

- Node.js 18 or newer
- npm

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/sanikatare/DS.git
cd DS
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev
```

Open the application at:

```text
http://localhost:3000
```

The development server starts Express and Vite together and serves the React dashboard with hot module support disabled in the embedded Vite middleware configuration.

### 4. Create a production build

```bash
npm run build
NODE_ENV=production npm start
```

The production server serves the generated Vite files from `dist`.

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server with `tsx` |
| `npm run build` | Build the React application with Vite |
| `npm run start` | Start the Node.js server |
| `npm run preview` | Preview the Vite build |
| `npm run lint` | Type-check the project with TypeScript |
| `npm run test:sync` | Run the distributed synchronization algorithm tests |

## Environment Variables

Copy `.env.example` to `.env` when custom behavior is needed:

```bash
cp .env.example .env
```

Important configuration values include:

| Variable | Purpose |
| --- | --- |
| `MAX_RETRIES` | Maximum retry attempts for downstream operations |
| `RETRY_DELAY_SECONDS` | Delay between retry attempts |
| `REQUEST_TIMEOUT_SECONDS` | Timeout for simulated service calls |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | Failures required to open a circuit |
| `CIRCUIT_BREAKER_RECOVERY_TIMEOUT` | Time before an open circuit enters half-open state |
| `CIRCUIT_BREAKER_SUCCESS_THRESHOLD` | Successful trial calls required to close a circuit |
| `VITE_TXN_API_URL` | Frontend transaction API URL |
| `VITE_TXN_WS_URL` | Frontend transaction WebSocket URL |
| `VITE_SENDER_BANK_URL` | Sender bank service URL |
| `VITE_NPCI_URL` | NPCI simulator URL |
| `VITE_RECEIVER_BANK_URL` | Receiver bank service URL |

The application provides local simulator defaults when these values are not set.

## Main API Endpoints

### Transactions and users

- `GET /health` — Transaction service health check
- `GET /api/users` — List simulated users and balances
- `GET /api/stats` — Transaction statistics
- `GET /api/snapshot` — Atomic dashboard snapshot
- `GET /api/transactions` — List transactions, optionally filtered by status
- `GET /api/transaction/:transactionId/status` — Retrieve one transaction
- `POST /api/transaction/initiate` — Start a simulated payment
- `GET /api/ledger` — Inspect journal entries, balances, and ledger invariants

Example transaction request:

```bash
curl -X POST http://localhost:3000/api/transaction/initiate \\
  -H "Content-Type: application/json" \\
  -d '{
    "senderId": "sanika@bank",
    "receiverId": "navya@bank",
    "amount": 500,
    "idempotencyKey": "demo-payment-001",
    "mode": "rest"
  }'
```

Supported transaction modes include:

- `rest`
- `grpc`
- `rabbitmq`
- `p2p` or `peer`

### Fault simulation

- `GET /failure/status` — View failure and circuit-breaker state
- `POST /failure/:target/enable` — Enable a failure for `sender-bank`, `npci`, or `receiver-bank`
- `POST /failure/:target/disable` — Disable a simulated node failure
- `POST /failure/timeout/enable` — Enable timeout simulation
- `POST /failure/timeout/disable` — Disable timeout simulation
- `POST /failure/reset-all` — Restore all services and circuit breakers
- `GET /api/circuit-breaker/status` — View circuit-breaker status
- `POST /api/circuit-breaker/reset` — Reset all circuit breakers

### Synchronization and coordination

- `GET /api/synchronization/clocks` — Physical clock state
- `POST /api/synchronization/clocks/sync` — Synchronize clocks using consensus
- `POST /api/synchronization/clocks/drift` — Introduce clock drift
- `GET /api/synchronization/lamport` — Lamport clocks and event history
- `POST /api/synchronization/lamport/event` — Create a Lamport local, send, or receive event
- `GET /api/synchronization/vector` — Vector clocks and history
- `POST /api/synchronization/vector/event` — Create a vector-clock event
- `POST /api/synchronization/vector/compare` — Compare two vector clocks
- `POST /api/synchronization/global-state/capture` — Capture a Chandy-Lamport snapshot
- `GET /api/synchronization/beacons` — View heartbeat and failure-detection state
- `POST /api/synchronization/election/bully` — Run a Bully election
- `POST /api/synchronization/election/ring` — Run a Ring election
- `POST /api/synchronization/mutex/request` — Request a distributed lock
- `POST /api/synchronization/mutex/release` — Release a distributed lock

## WebSocket and WebRTC

### Transaction event stream

Connect to:

```text
ws://localhost:3000/ws/transactions
```

The transaction stream provides real-time events containing transaction state, service name, timestamps, sequence numbers, Lamport clocks, and vector clocks.

To replay events after a known sequence number:

```text
ws://localhost:3000/ws/transactions?lastSequence=25
```

The stream maintains a bounded replay buffer and supports `ping`, `stats`, and `replay` messages.

### WebRTC signaling

Connect to:

```text
ws://localhost:3000/ws/webrtc?roomId=demo-room&peerId=peer-a
```

The WebRTC endpoint provides signaling support for peer discovery, offers, answers, ICE candidates, joining, and leaving rooms. The server acts as a signaling relay and does not route the actual peer data channel payload.

## Project Structure

```text
.
├── index.html                 # Vite HTML entry point
├── package.json               # Scripts and dependencies
├── server.ts                  # Express, WebSocket, WebRTC, and simulator orchestration
├── test_synchronization.ts    # Synchronization algorithm test suite
├── tsconfig.json              # TypeScript configuration
├── vite.config.ts             # Vite configuration
├── metadata.json              # Project metadata
├── .env.example               # Environment variable template
└── src/
    ├── App.jsx               # Main React application
    ├── api.js                # Frontend API helpers
    ├── main.jsx              # React entry point
    ├── styles.css            # Application styling
    ├── components/            # Reusable UI components
    ├── pages/                 # Dashboard pages and views
    └── server/                # Distributed-systems algorithms and services
```

## Running the Tests

Run the synchronization tests with:

```bash
npm run test:sync
```

The test suite covers:

1. Lamport logical clocks
2. Vector clocks and happens-before relationships
3. Physical clock synchronization
4. Chandy-Lamport global-state snapshots
5. Beacon-protocol failure detection and recovery

Run the TypeScript checks with:

```bash
npm run lint
```

## Educational Topics Demonstrated

This project can be used as a practical companion for distributed-systems coursework, including:

- Distributed architectures and middleware
- Message passing and remote procedure calls
- Logical and physical clock synchronization
- Causal ordering and concurrency
- Global-state recording
- Failure detection and recovery
- Leader election
- Distributed mutual exclusion
- Fault tolerance and availability trade-offs
- ACID, BASE, Saga, and consistency concepts
- Real-time distributed web applications

## Limitations

- Data is stored in memory and is lost when the server restarts.
- Banking services and NPCI are simulated locally.
- Authentication, authorization, encryption, and production-grade persistence are not implemented.
- RabbitMQ and external gRPC services are represented as educational protocol modes unless separately configured.
- This project must not be used for real payment processing.

## License

No license has been specified for this repository yet. Add a license before distributing or reusing the project publicly.
