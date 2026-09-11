#!/usr/bin/env bash
# Start the static server in the background. Re-running this script stops
# any previously started instance first, then starts a fresh one.
#
# Usage:
#   ./start.sh                # port 6010 (default)
#   ./start.sh 3000           # custom port
#   ./start.sh --port 3000
#   ./start.sh --https        # self-signed HTTPS, port 6010
#   ./start.sh --https --port 4443

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PID_FILE="$DIR/.server.pid"
LOG_FILE="$DIR/server.log"
PORT="${PORT:-6010}"

ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="$2"
      shift 2
      ;;
    --https)
      ARGS+=("--https")
      shift
      ;;
    ''|*[!0-9]*)
      ARGS+=("$1")
      shift
      ;;
    *)
      PORT="$1"
      shift
      ;;
  esac
done
ARGS+=("--port" "$PORT")

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "停止舊的伺服器程序 (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# Safety net: also stop anything already listening on the target port, in
# case it wasn't (or is no longer) the process this script is tracking.
STALE_PIDS="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
if [[ -n "$STALE_PIDS" ]]; then
  echo "port $PORT 已被佔用 (PID: $STALE_PIDS)，一併停止..."
  kill $STALE_PIDS 2>/dev/null || true
  sleep 0.3
  kill -9 $STALE_PIDS 2>/dev/null || true
fi

nohup node "$DIR/server.js" "${ARGS[@]}" > "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"
sleep 0.5

if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "伺服器已啟動 (PID $NEW_PID)"
  echo "log: $LOG_FILE"
  echo "---"
  tail -n 10 "$LOG_FILE" || true
else
  rm -f "$PID_FILE"
  echo "伺服器啟動失敗，請查看 $LOG_FILE"
  echo "---"
  tail -n 20 "$LOG_FILE" || true
  exit 1
fi
