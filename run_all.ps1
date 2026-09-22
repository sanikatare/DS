# UPI Distributed Transaction Simulator - Launcher Script
# Starts all 4 backend microservices and the React frontend in separate windows.

$ROOT = $PSScriptRoot

Write-Host "Starting UPI Distributed Transaction Simulator Services..." -ForegroundColor Cyan

# 1. Transaction Service (Port 8000)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT'; & '$ROOT\venv\Scripts\python.exe' -m uvicorn services.transaction-service.app.main:app --host 127.0.0.1 --port 8000 --reload"

# 2. Sender Bank Service (Port 8001 / gRPC 50051)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT'; & '$ROOT\venv\Scripts\python.exe' -m uvicorn services.sender-bank-service.app.main:app --host 127.0.0.1 --port 8001 --reload"

# 3. NPCI Simulator Service (Port 8002 / gRPC 50052)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT'; & '$ROOT\venv\Scripts\python.exe' -m uvicorn services.npci-simulator-service.app.main:app --host 127.0.0.1 --port 8002 --reload"

# 4. Receiver Bank Service (Port 8003 / gRPC 50053)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT'; & '$ROOT\venv\Scripts\python.exe' -m uvicorn services.receiver-bank-service.app.main:app --host 127.0.0.1 --port 8003 --reload"

# 5. Frontend Dev Server (Port 5173)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT\frontend'; npm run dev"

Write-Host "All 5 services launched! Access the app at http://localhost:5173" -ForegroundColor Green
