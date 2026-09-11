#!/usr/bin/env bash
# Stop the server started by start.sh.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$DIR/.server.pid"

STOPPED=0

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "$PID" 2>/dev/null || true
    echo "伺服器已停止 (PID $PID)"
    STOPPED=1
  fi
  rm -f "$PID_FILE"
fi

# Safety net: also stop any instance of this project's server.js that the
# pidfile lost track of (e.g. started outside start.sh, or a stale pidfile).
STRAY_PIDS="$(pgrep -f "node .*${DIR}/server\.js" 2>/dev/null || true)"
if [[ -n "$STRAY_PIDS" ]]; then
  echo "停止未被追蹤的伺服器程序 (PID: $STRAY_PIDS)..."
  kill $STRAY_PIDS 2>/dev/null || true
  sleep 0.3
  kill -9 $STRAY_PIDS 2>/dev/null || true
  STOPPED=1
fi

if [[ "$STOPPED" -eq 0 ]]; then
  echo "伺服器未在執行"
fi
