#!/usr/bin/env bash
# VMP-sign the Electron app so DRM services will issue licences.
#
# Why this is needed: Netflix returns E100 and GagaOOLala returns "license
# request failed" for the same reason — the app carries only a development
# Widevine signature, and both services refuse to issue a licence to an
# unsigned client. Signing is free through castlabs' EVS service, but it needs
# an account, and only you can create that.
#
# Run ./sign.sh once. It checks you are signed up, signs the app, and tells you
# what to do next.
#
# The account is yours. This script never sees or stores your password — the
# EVS tool prompts you directly and keeps its own credentials.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$ROOT/../ml/.venv/bin/python"
APP="$ROOT/node_modules/electron/dist"

if [ ! -d "$APP/Electron.app" ]; then
  echo "Electron not found at $APP — run npm install first"
  exit 1
fi

echo "Checking your EVS account…"
if ! "$PY" -m castlabs_evs.account refresh >/dev/null 2>&1; then
  cat <<'MSG'

You are not signed up yet. Do this first, in this terminal:

    ../ml/.venv/bin/python -m castlabs_evs.account signup

It asks for a username, a password, and an email address. It is free.
Then confirm the code it emails you, and run ./sign.sh again.

MSG
  exit 1
fi

echo "Signing the app…"
if "$PY" -m castlabs_evs.vmp sign-pkg "$APP"; then
  cat <<'MSG'

Signed.

Now try again:

    npm start

Then play something. If a video plays, the DRM side is solved.

MSG
else
  echo
  echo "Signing failed. The output above says why."
  exit 1
fi
