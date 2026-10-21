#!/usr/bin/env bash
set -e

PORT=${1:-4174}   # 4173 is ontology-ui
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
\. "$NVM_DIR/nvm.sh"

echo "Node $(node -v)  npm $(npm -v)"

echo ""
echo "Checking dependencies..."
npm install --silent

echo ""
echo "Building..."
npm run build

if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
  echo ""
  echo "Stopping existing server on :$PORT..."
  lsof -ti tcp:"$PORT" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# Static server only: dumps are annotated in the browser and never sent anywhere.
echo ""
echo "Starting server on :$PORT..."
nohup npx vite preview --host --port "$PORT" --strictPort > /tmp/cli-annotator-serve.log 2>&1 &
SERVER_PID=$!

for i in $(seq 1 20); do
  if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
    echo "Ready  ->  http://localhost:$PORT"
    echo "(log: /tmp/cli-annotator-serve.log  pid: $SERVER_PID)"
    exit 0
  fi
  sleep 1
done

echo "Server did not start within 20 s — check /tmp/cli-annotator-serve.log"
exit 1
