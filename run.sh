#!/bin/bash

# Start backend
echo "🚀 Starting Screw Claude IDE..."
echo "   Backend: http://localhost:3001"
echo "   Frontend: http://localhost:3000"
echo ""

# Kill existing processes on our ports
fuser -k 3000/tcp 2>/dev/null || true
fuser -k 3001/tcp 2>/dev/null || true

# Start backend in background
cd backend && npm run dev &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 2

# Start frontend
cd frontend && npm start &
FRONTEND_PID=$!
cd ..

echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo ""
echo "Press Ctrl+C to stop both"

# Handle shutdown
cleanup() {
  echo ""
  echo "Stopping..."
  kill $BACKEND_PID 2>/dev/null || true
  kill $FRONTEND_PID 2>/dev/null || true
  exit 0
}

trap cleanup SIGINT SIGTERM
wait
