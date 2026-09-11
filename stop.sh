#!/usr/bin/env bash
# Stop the server started by start.sh.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$DIR/.server.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "沒有找到執行中的伺服器"
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "$PID" ]] || ! kill -0 "$PID" 2>/dev/null; then
  echo "伺服器未在執行"
  rm -f "$PID_FILE"
  exit 0
fi

kill "$PID" 2>/dev/null || true
for _ in $(seq 1 20); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.2
done
kill -9 "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "伺服器已停止 (PID $PID)"
