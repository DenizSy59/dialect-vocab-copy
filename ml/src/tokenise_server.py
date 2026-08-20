"""Long-lived tokeniser. Reads JSON lines on stdin, writes JSON lines on stdout.

The API used to spawn a fresh Python process for every subtitle line. That cost
the full import and model load each time — measured at 0.4 s for Chinese, 1.3 s
for Korean and 2.5 s for Turkish. Streaming subtitles change every two seconds
or so, which meant Turkish results always arrived after the line had already
gone and were thrown away. The feature looked broken for exactly the languages
with the heaviest tokenisers.

Keeping one process alive fixes it: the tokenisers load once and every
subsequent line costs a few milliseconds.

Protocol, one JSON object per line in each direction:
    in   {"id": 1, "text": "…", "language": "ko"}
    out  {"id": 1, "tokens": [...]}          on success
    out  {"id": 1, "error": "…"}             on failure

An id is carried through because the API pipelines requests and needs to match
answers to questions. Errors are returned rather than raised so one bad line
cannot take the process down and strand every later request.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lemmatise import get_tokeniser
from romanise import add_readings

_tokenisers = {}
# Translators are keyed by (source, target). Each Marian model is about 300 MB
# and a pivot route holds two, so they are built on demand rather than upfront —
# but once built they stay, because loading one per sentence would be as slow as
# the per-request tokeniser this file exists to replace.
_translators = {}


def tokeniser_for(language: str):
    if language not in _tokenisers:
        _tokenisers[language] = get_tokeniser(language)
    return _tokenisers[language]


def translator_for(source: str, target: str):
    key = (source, target)
    if key not in _translators:
        from translate import build_translator
        _translators[key] = build_translator(source, target)
    return _translators[key]


def main():
    # Preload the common case so the first real subtitle is not the one that
    # pays for the import.
    for lang in ("ko", "zh"):
        try:
            tokeniser_for(lang)
        except Exception:
            pass
    # The Korean g2p model is the slowest thing here to load, so warm it now
    # rather than stalling the first subtitle that needs a reading.
    try:
        from romanise import reading
        reading("한국", "ko")
    except Exception:
        pass

    # Line-buffered, so the API sees each answer as soon as it is written
    # rather than when a buffer happens to fill.
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        rid = req.get("id")
        try:
            # Two operations share the process because both need heavy models
            # resident and neither is worth its own service.
            if req.get("op") == "translate":
                source = req["source"]
                target = req["target"]
                if source == target:
                    print(json.dumps({"id": rid, "texts": req["texts"]},
                                     ensure_ascii=False), flush=True)
                    continue
                tr = translator_for(source, target)
                out = tr(req["texts"]) if tr else req["texts"]
                print(json.dumps({"id": rid, "texts": out}, ensure_ascii=False), flush=True)
                continue

            tk = tokeniser_for(req["language"])
            tokens = [t.to_dict() for t in tk(req["text"])]
            add_readings(tokens, req["language"])
            print(json.dumps({"id": rid, "tokens": tokens}, ensure_ascii=False), flush=True)
        except Exception as e:
            print(json.dumps({"id": rid, "error": str(e)[:300]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
