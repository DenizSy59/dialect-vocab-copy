"""Score how hard each segment is, so a long video can be navigated by difficulty.

Three things make a stretch of speech hard for a learner, and all three are
measurable from what the pipeline already produces:

1. **Speech rate** — characters per second. Fast delivery is hard even when
   every word is known.
2. **Word rarity** — how uncommon the content words are, from the wordfreq
   corpus. This is the one that tracks "will I need the dictionary".
3. **Density** — how much of the segment is content words rather than grammar.
   A sentence that is mostly particles is easier than one packed with nouns.

Dialect divergence is the fourth factor the brief asks for. It is not here yet
because there is no dialect classifier, so the weights below will need
revisiting once there is.

Scores are 0 to 1. They are a heuristic, not a measurement — nobody has
validated that a 0.7 segment is genuinely harder for a real learner than a 0.5
one, and that would need actual learners to establish.
"""

import math
from typing import Optional

# wordfreq wants MeCab to tokenise Korean, which we do not need — kiwi already
# did that. Pulling the raw frequency table skips the tokeniser entirely.
_freq_cache: dict[str, dict] = {}


def frequency_table(language: str) -> dict:
    if language not in _freq_cache:
        from wordfreq import get_frequency_dict
        _freq_cache[language] = get_frequency_dict(language)
    return _freq_cache[language]


def zipf(word: str, table: dict) -> Optional[float]:
    """Zipf scale: roughly 7 for the commonest words, 1-2 for very rare ones."""
    f = table.get(word)
    return math.log10(f) + 9 if f else None


# Anything at or below this is treated as fully unfamiliar; at or above the
# upper bound, fully familiar. Picked from the observed spread: 사람 is 6.3,
# 수비수 is 3.5, and words below about 3 are ones a learner would look up.
ZIPF_HARD = 3.0
ZIPF_EASY = 6.0

# Characters per second. Korean and Chinese news delivery sits around 5-7;
# above 9 is fast conversational speech.
RATE_EASY = 4.0
RATE_HARD = 9.0


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def score_segment(text: str, tokens: list, start: float, end: float,
                  table: dict) -> Optional[float]:
    """Return 0-1, or None when there is nothing to judge."""
    duration = (end or 0) - (start or 0)
    if duration <= 0 or not text:
        return None

    # 1. Speech rate.
    rate = len(text) / duration
    rate_score = clamp01((rate - RATE_EASY) / (RATE_HARD - RATE_EASY))

    # 2. Rarity of content words. Words missing from the table are unknown to a
    # large corpus, so treating them as hard is the right default — that is
    # exactly the case of a rare term or a name.
    content = [t for t in tokens if t.get("content")]
    if content:
        rarities = []
        for t in content:
            z = zipf(t.get("lemma") or t.get("surface", ""), table)
            rarities.append(1.0 if z is None else clamp01((ZIPF_EASY - z) / (ZIPF_EASY - ZIPF_HARD)))
        # Mean of the hardest third rather than the mean of everything: one
        # unknown word in an easy sentence still sends a learner to a
        # dictionary, and averaging hides that.
        rarities.sort(reverse=True)
        top = rarities[: max(1, len(rarities) // 3)]
        rarity_score = sum(top) / len(top)
    else:
        rarity_score = 0.0

    # 3. Content density.
    density = len(content) / len(tokens) if tokens else 0.0
    density_score = clamp01((density - 0.3) / 0.4)

    # Rarity is weighted highest because it is the factor most specific to
    # vocabulary learning, which is what this app is for.
    score = 0.30 * rate_score + 0.50 * rarity_score + 0.20 * density_score
    return round(clamp01(score), 3)


def score_all(segments: list, language: str) -> None:
    """Add a 'difficulty' key to each segment dict, in place."""
    table = frequency_table(language)
    for seg in segments:
        seg["difficulty"] = score_segment(
            seg.get("text", ""), seg.get("tokens", []),
            seg.get("start"), seg.get("end"), table,
        )
