#!/usr/bin/env bash
# Run every test suite.
#
# The API tests need the stack running, because they exercise the seams — Node
# to Python, Node to Mongo, the encoding boundary — and that is where every bug
# found by hand this project has lived.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fail=0

echo "== python (pipeline, tokenising, dialect, evaluation) =="
"$ROOT/ml/.venv/bin/python" -m pytest "$ROOT/ml/tests/" -q || fail=1

echo
echo "== api (routes, end to end) =="
if curl -fsS --max-time 2 http://localhost:4000/api/health >/dev/null 2>&1; then
  node --test "$ROOT/api/test/api.test.js" 2>&1 | tail -8 || fail=1
else
  echo "  skipped — API is not running. Start it with ./run.sh"
fi

exit $fail
