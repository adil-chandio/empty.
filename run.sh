#!/usr/bin/env bash
# TABAHI — run helpers
set -e

case "$1" in
  dev|start)
    echo "🚀 Starting TABAHI preview dev server..."
    npx http-server . -p 5000 -o
    ;;
  install)
    echo "📦 Installing dependencies..."
    npm install
    ;;
  *)
    echo "Usage: ./run.sh {dev|install}"
    echo "  dev    - start live preview server (port 5000)"
    echo "  install - npm install"
    ;;
esac
