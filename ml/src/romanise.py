"""Readings for scripts a learner cannot yet decode.

A beginner looking at 학교 or 学校 sees a shape, not a word. A reading turns it
into something pronounceable while the script is still being learned, and the
toggle exists because it should stop being shown once it is not needed —
permanent romanisation is a well-known way to never learn the script.

**Korean** goes through grapheme-to-phoneme first. Romanising the written form
directly is wrong often enough to matter: 신라 is pronounced 실라 (silla, not
"sinra"), 종로 is 종노 (jongno, not "jongro") and 국물 is 궁물 (gungmul). Those
are assimilation rules, and a tool that teaches "sinra" is teaching a
mispronunciation. g2pk2 applies the rules, then the result is romanised.

**Chinese** uses pypinyin, which handles the polyphone problem — 行 is xíng in
银行 and háng elsewhere — by looking at the whole word rather than a character
at a time.

Turkish and English are already Latin and get nothing.
"""

_g2p = None
_romanizer = None

# The romaniser writes the ㄹㄹ sequence as "lr" because it maps each jamo
# independently. Revised Romanization writes it "ll" — silla, not silra.
_KO_FIXES = [("lr", "ll")]


def _korean_tools():
    global _g2p, _romanizer
    if _g2p is None:
        from g2pk2 import G2p
        from korean_romanizer.romanizer import Romanizer
        _g2p = G2p()
        _romanizer = Romanizer
    return _g2p, _romanizer


def korean(text: str) -> str:
    """Revised Romanization of how the word is actually pronounced."""
    if not text or not any("가" <= c <= "힣" for c in text):
        return ""
    try:
        g2p, Romanizer = _korean_tools()
        spoken = g2p(text)
        out = Romanizer(spoken).romanize()
    except Exception:
        return ""
    for a, b in _KO_FIXES:
        out = out.replace(a, b)
    return out


def chinese(text: str) -> str:
    """Pinyin with tone marks, chosen per word rather than per character."""
    if not text:
        return ""
    try:
        from pypinyin import pinyin, Style
        return "".join(x[0] for x in pinyin(text, style=Style.TONE))
    except Exception:
        return ""


def reading(text: str, language: str) -> str:
    if language == "ko":
        return korean(text)
    if language == "zh":
        return chinese(text)
    # Latin script already; a "reading" would just repeat the word.
    return ""


def add_readings(tokens: list, language: str) -> None:
    """Attach a reading to each content token, in place.

    Only content words: nobody needs a romanisation of a particle they are not
    going to save, and generating one per token is the slow part.
    """
    if language not in ("ko", "zh"):
        return
    cache = {}
    for t in tokens:
        if not t.get("content"):
            t["reading"] = ""
            continue
        surface = t.get("surface", "")
        if surface not in cache:
            cache[surface] = reading(surface, language)
        t["reading"] = cache[surface]
