"""Detect regional speech variation from the transcript text.

The brief's plan A was an audio classifier trained on AI-Hub's Korean dialect
corpora, with a documented fallback: if that data cannot be obtained from
Cyprus, use text instead, because dialect is not only pronunciation — distinctive
endings and word choices show up in the transcript.

This is that fallback, and it is a **rule-based detector, not a trained
classifier**. It counts known dialect markers, weights them by how exclusive
each one is to its dialect, and normalises by transcript length. It cannot
learn, it only knows the markers in `data/dialect_markers.json`, and those lists
were compiled from descriptive grammars and have not been checked by a native
speaker.

Matching runs over **tokens, not raw text**. Substring matching was tried first
and was useless: counting the character 노 flagged every transcript containing
노력 ("effort") as Gyeongsang. Endings are matched only against tokens the
tagger actually labelled as endings.

See LOG.md for the more serious limitation this cannot fix — that ASR tends to
normalise dialect speech into standard forms before the text ever reaches here.

Usage:
    from dialect import detect
    result = detect(segments, "ko")
"""

import json
from pathlib import Path

MARKERS_PATH = Path(__file__).parent.parent / "data" / "dialect_markers.json"

_markers = None

# Korean tags for verbal endings. A dialect ending is only an ending when the
# tagger says it is one; anywhere else the same syllable is part of a word.
KO_ENDING_TAGS = {"EF", "EC", "EP", "ETM", "ETN"}


def markers(language: str) -> dict:
    global _markers
    if _markers is None:
        _markers = json.loads(MARKERS_PATH.read_text(encoding="utf-8"))
    return {k: v for k, v in _markers.get(language, {}).items() if not k.startswith("_")}


# A marker score below this is treated as no signal. Single stray matches in a
# long transcript are usually coincidence.
MIN_SCORE = 0.6

# Markers per 1000 tokens, so a long video is not flagged simply for being long.
SCALE = 1000.0


def _iter_tokens(segments: list):
    for seg in segments:
        for tok in seg.get("tokens", []):
            yield tok


def _eojeols(segments: list) -> list:
    """Space-delimited chunks.

    Needed because many Korean dialect words are multi-morpheme and the tagger
    takes them apart: 억수로 comes back as 억수 + 로, so a token-level equality
    test never sees the marker. The eojeol keeps it whole.
    """
    out = []
    for seg in segments:
        out.extend(seg.get("text", "").split())
    return out


def _eojeol_match(eojeol: str, marker: str) -> bool:
    """Exact, or a prefix when the marker is long enough to be safe.

    Prefix matching lets 억수로 match 억수로도, but is only allowed from three
    syllables up. At two it does real damage: 고마 would swallow 고마워요
    ("thank you"), which is ordinary standard Korean.
    """
    if eojeol == marker:
        return True
    return len(marker) >= 3 and eojeol.startswith(marker)


def _matches(tok: dict, marker: str, group: str, language: str) -> bool:
    surface = tok.get("surface", "")
    lemma = tok.get("lemma", "")
    pos = tok.get("pos", "")

    if group == "endings":
        if language == "ko":
            # Must be tagged as an ending, and the ending must actually end with
            # the marker — kiwi splits 했능교 into pieces, so equality is too
            # strict but a substring anywhere is too loose.
            return pos in KO_ENDING_TAGS and surface.endswith(marker)
        # Chinese sentence-final particles are their own tokens.
        return surface == marker

    return surface == marker or lemma == marker


def scan(segments: list, language: str) -> dict:
    """Weighted marker counts per dialect, with the evidence that produced them."""
    tokens = list(_iter_tokens(segments))
    eojeols = _eojeols(segments) if language == "ko" else []
    out = {}
    for key, spec in markers(language).items():
        hits, score = [], 0.0
        for group in ("endings", "words"):
            for marker, weight in spec.get(group, []):
                n = sum(1 for t in tokens if _matches(t, marker, group, language))
                # Korean vocabulary markers also checked whole-word, since the
                # tagger splits many of them apart.
                if group == "words" and language == "ko":
                    n = max(n, sum(1 for e in eojeols if _eojeol_match(e, marker)))
                if n:
                    score += n * weight
                    hits.append({"marker": marker, "count": n, "weight": weight})
        out[key] = {
            "label": spec.get("label", key),
            "raw_score": round(score, 2),
            "hits": sorted(hits, key=lambda h: -h["count"] * h["weight"])[:8],
        }
    return out, len(tokens)


def detect(segments: list, language: str) -> dict:
    """Judge the whole transcript.

    Returns the non-standard dialect with the strongest signal, if any clears
    the threshold, plus the evidence so a user can see *why*. An unexplained
    "this is Gyeongsang" is not useful to a learner and not checkable by a
    supervisor either.
    """
    scanned, n_tokens = scan(segments, language)
    if not n_tokens:
        return {"available": False, "reason": "no tokens"}

    per_1k = n_tokens / SCALE or 1.0
    for v in scanned.values():
        v["score"] = round(v["raw_score"] / per_1k, 2)

    regional = {k: v for k, v in scanned.items() if k != "standard"}
    if not regional:
        return {"available": False, "reason": f"no markers defined for {language}"}

    top_key = max(regional, key=lambda k: regional[k]["score"])
    top = regional[top_key]
    standard_score = scanned.get("standard", {}).get("score", 0.0)

    # Both tests matter. The absolute one stops a single stray marker from
    # firing; the relative one stops a transcript that is overwhelmingly
    # standard from being called regional because of a couple of hits.
    detected = top["score"] >= MIN_SCORE and top["score"] > standard_score * 0.35

    return {
        "available": True,
        "method": "text-marker heuristic over POS-tagged tokens (no trained classifier)",
        "detected": detected,
        "dialect": top_key if detected else "standard",
        "label": top["label"] if detected else "Standard",
        "score": top["score"],
        "standard_score": standard_score,
        "tokens_scanned": n_tokens,
        "evidence": top["hits"] if detected else [],
        "all_scores": {k: v["score"] for k, v in scanned.items()},
        # Said plainly because the number invites more confidence than it earns.
        "caveat": (
            "Rule-based marker counting, not a trained classifier. Marker lists "
            "are unvalidated by a native speaker, accuracy is unmeasured, and "
            "ASR tends to normalise dialect speech into standard forms before "
            "this ever sees it."
        ),
    }


def annotate_segments(segments: list, language: str) -> None:
    """Tag individual segments that carry strong markers, in place.

    Whole-transcript detection tells a learner the video is regional. Per
    segment tells them which line was the odd one, which is what they need when
    a form looks wrong and they cannot tell whether they misread it.
    """
    for seg in segments:
        found = []
        toks = seg.get("tokens", [])
        # Same eojeol fallback the whole-transcript scan uses. Without it a
        # video could report a dialect while no individual line was marked,
        # because the tagger had split every marker apart.
        eojeols = seg.get("text", "").split() if language == "ko" else []

        for key, spec in markers(language).items():
            if key == "standard":
                continue
            for group in ("endings", "words"):
                for marker, weight in spec.get(group, []):
                    # Only strong markers per segment; weak ones produce a wall
                    # of false positives at this granularity.
                    if weight < 3:
                        continue
                    hit = any(_matches(t, marker, group, language) for t in toks)
                    if not hit and group == "words" and language == "ko":
                        hit = any(_eojeol_match(e, marker) for e in eojeols)
                    if hit:
                        found.append({"dialect": key, "marker": marker})
        seg["dialectMarkers"] = found[:4]
