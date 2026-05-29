#!/bin/bash
set -e

echo "⚡ Setting up Screw Claude IDE..."

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from: https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required. Current: $(node -v)"
  exit 1
fi

echo "✅ Node.js $(node -v)"

# Check for node-pty build deps
echo "📦 Checking build dependencies for terminal support..."
if command -v apt-get &> /dev/null; then
  echo "Installing build tools (may need sudo)..."
  sudo apt-get install -y python3 make g++ 2>/dev/null || true
fi

# Setup .env
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo ""
  echo "📝 Created backend/.env from template."
  echo "   Edit it to add your API keys:"
  echo "   nano backend/.env"
  echo ""
fi

# Install deps
echo "📦 Installing backend dependencies..."
cd backend && npm install
cd ..

echo "📦 Installing frontend dependencies..."
cd frontend && npm install
cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Add your API keys: nano backend/.env"
echo "  2. Set WORKSPACE_ROOT in backend/.env to your project directory"
echo "  3. Run: ./run.sh"
echo ""
