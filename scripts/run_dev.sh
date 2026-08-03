#!/usr/bin/env bash
# Runs backend (uvicorn, auto-reload) and frontend (vite dev server) together.
# Ctrl+C stops both. Assumes dependencies are already installed:
#   pip install -r server/requirements.txt
#   npm install --prefix client
set -euo pipefail

cd "$(dirname "$0")/.."

cleanup() {
  echo ""
  echo "Stopping..."
  kill "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Starting backend on http://localhost:8000 ..."
(cd server && uvicorn app.main:app --reload --port 8000) &
SERVER_PID=$!

echo "Starting frontend on http://localhost:5173 ..."
(cd client && npm run dev) &
CLIENT_PID=$!

wait "$SERVER_PID" "$CLIENT_PID"
