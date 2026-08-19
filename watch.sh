#!/usr/bin/env bash
# Open a streaming site in a Chrome window that already has Lexicon loaded.
#
#   ./watch.sh              Netflix
#   ./watch.sh viki         Viki
#   ./watch.sh test         the local test player, no account needed
#
# This exists because the manual extension install — developer mode, load
# unpacked, find the folder — is a genuine barrier, and it is not the
# interesting part of the project. Chrome can load an unpacked extension
# straight from the command line, so this does it for you.
#
# WHY NOT A DESKTOP APP: a desktop app could open Netflix in a window of its
# own, and that part is easy. Playing the video is not. Netflix is encrypted
# with Widevine, stock Electron does not ship the Widevine module, and the
# builds that do require a commercial signing certificate. So a hand-rolled
# app would very likely open Netflix and then refuse to play anything. This
# uses real Chrome, which already has Widevine, so playback simply works.
#
# You log into Netflix yourself in this window. It uses a separate Chrome
# profile kept inside the project, so it does not touch your normal browser
# profile, and your login stays between you and Netflix.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT="$ROOT/extension"
PROFILE="$ROOT/.chrome-profile"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

case "${1:-netflix}" in
  netflix)    URL="https://www.netflix.com/browse" ;;
  prime)      URL="https://www.primevideo.com" ;;
  viki)       URL="https://www.viki.com" ;;
  iqiyi)      URL="https://www.iq.com" ;;
  gagaoolala) URL="https://www.gagaoolala.com" ;;
  test)       URL="http://localhost:4000/extension-test.html" ;;
  *)          URL="$1" ;;
esac

if [ ! -x "$CHROME" ]; then
  echo "Google Chrome not found at:"
  echo "  $CHROME"
  echo
  echo "Install Chrome, or use the manual route: chrome://extensions ->"
  echo "Developer mode -> Load unpacked -> $EXT"
  exit 1
fi

# The API has to be up or the extension has nothing to talk to, and the
# failure looks like the extension being broken rather than absent.
if ! curl -fsS --max-time 2 http://localhost:4000/api/health >/dev/null 2>&1; then
  echo "Lexicon is not running — starting it"
  "$ROOT/run.sh" >/dev/null || exit 1
fi

mkdir -p "$PROFILE"

echo "opening $URL"
echo "  extension: $EXT"
echo "  profile:   $PROFILE  (separate from your normal Chrome)"
echo
echo "Log in to the site in this window as you normally would."
echo "Play something with subtitles, and the LEXICON bar appears underneath."

"$CHROME" \
  --user-data-dir="$PROFILE" \
  --load-extension="$EXT" \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=DisableLoadExtensionCommandLineSwitch \
  "$URL" >/dev/null 2>&1 &

disown
