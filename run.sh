#!/usr/bin/env bash
# Start everything Lexicon needs, detached, so it keeps running after the
# terminal that launched it goes away.
#
# This exists because the API and the worker were being started as ordinary
# background jobs, which die with their parent shell — and when they died the
# site served nothing, which looks exactly like a broken front end. Nothing was
# broken; there was simply no server.
#
#   ./run.sh          start everything
#   ./run.sh stop     stop the API and worker (leaves mongo and redis alone)
#   ./run.sh status   what is currently up
#   ./run.sh logs     tail both logs
#
# Mongo and Redis are left running on purpose: they are shared services, they
# cost almost nothing idle, and stopping them would disturb anything else using
# them.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS="$ROOT/logs"
mkdir -p "$LOGS"

API_LOG="$LOGS/api.log"
WORKER_LOG="$LOGS/worker.log"

api_pid()    { pgrep -f "node $ROOT/api/src/index.js" | head -1; }
worker_pid() { pgrep -f "$ROOT/ml/src/worker.py" | head -1; }

wait_for_api() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 http://localhost:4000/api/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start() {
  # Redis: needed for the job queue.
  if ! redis-cli ping >/dev/null 2>&1; then
    echo "starting redis"
    brew services start redis >/dev/null 2>&1
    sleep 2
  fi

  # Mongo: run directly rather than through brew services, which refuses to
  # load the formula from the untrusted mongodb tap.
  if ! nc -z 127.0.0.1 27017 >/dev/null 2>&1; then
    echo "starting mongod"
    mongod --config /opt/homebrew/etc/mongod.conf --fork >/dev/null 2>&1 ||
      mongod --dbpath /opt/homebrew/var/mongodb \
             --logpath /opt/homebrew/var/log/mongodb/mongo.log --fork >/dev/null 2>&1
    sleep 2
  fi

  if [ -z "$(api_pid)" ]; then
    echo "starting api"
    # nohup + disown so it outlives this shell and its terminal.
    nohup node "$ROOT/api/src/index.js" >>"$API_LOG" 2>&1 &
    disown
  else
    echo "api already running (pid $(api_pid))"
  fi

  if [ -z "$(worker_pid)" ]; then
    echo "starting worker"
    nohup "$ROOT/ml/.venv/bin/python" "$ROOT/ml/src/worker.py" >>"$WORKER_LOG" 2>&1 &
    disown
  else
    echo "worker already running (pid $(worker_pid))"
  fi

  if wait_for_api; then
    echo
    echo "  ready:  http://localhost:4000"
    echo "  logs:   $LOGS"
  else
    echo
    echo "  the api did not come up — last lines of $API_LOG:"
    tail -20 "$API_LOG"
    exit 1
  fi
}

stop() {
  for name in api worker; do
    pid=$([ "$name" = api ] && api_pid || worker_pid)
    if [ -n "$pid" ]; then
      echo "stopping $name (pid $pid)"
      kill "$pid" 2>/dev/null
    else
      echo "$name not running"
    fi
  done
}

status() {
  printf "  redis   %s\n" "$(redis-cli ping >/dev/null 2>&1 && echo UP || echo DOWN)"
  printf "  mongo   %s\n" "$(nc -z 127.0.0.1 27017 >/dev/null 2>&1 && echo UP || echo DOWN)"
  printf "  api     %s\n" "$([ -n "$(api_pid)" ] && echo "UP (pid $(api_pid))" || echo DOWN)"
  printf "  worker  %s\n" "$([ -n "$(worker_pid)" ] && echo "UP (pid $(worker_pid))" || echo DOWN)"
  printf "  http    %s\n" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:4000/ 2>/dev/null)"
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop ;;
  restart) stop; sleep 2; start ;;
  status) status ;;
  logs)   tail -f "$API_LOG" "$WORKER_LOG" ;;
  *) echo "usage: ./run.sh [start|stop|restart|status|logs]"; exit 1 ;;
esac
