"""Build a levelled vocabulary curriculum into MongoDB.

The point of the app is mining words from video you chose. That is good for
retention and bad for coverage: you learn whatever happened to be said, in
whatever order it was said. A curriculum supplies the missing half — a defined
set of words, in a sensible order, so progress is measurable.

Two sources, because one does not exist for every language:

**Chinese: HSK 3.0.** The official standard, levels 1-6 plus the combined 7-9
band, from ivankra/hsk30 (MIT). This is the same syllabus commercial apps build
their Chinese courses on, so using the standard directly is both cleaner and
citable, rather than copying any particular app's lesson list.

**Korean, Turkish, English: frequency bands.** No openly licensed TOPIK-style
list was available at a usable quality, and inventing one would be worse than
using frequency. Ordering vocabulary by corpus frequency is well established in
second-language acquisition — the commonest words carry the most text coverage
per word learned — so bands of Zipf frequency become levels.

The two are not equivalent and the app says which is which, because "HSK 3" is
a claim about a public standard while "Level 3" here is a claim about our own
banding.

Usage:
    python src/curriculum.py            # all languages
    python src/curriculum.py --only zh
"""

import argparse
import csv
import math
import os
import urllib.request
from pathlib import Path

from pymongo import MongoClient, ASCENDING

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://127.0.0.1:27017/dialect_vocab")
DATA = Path(__file__).parent.parent / "data" / "curriculum"

HSK_URL = "https://raw.githubusercontent.com/ivankra/hsk30/master/hsk30.csv"

# Level sizes, as a share of the word list.
#
# Banding by absolute Zipf value was tried first and produced a lopsided
# curriculum: Turkish and English reached only level 2 because their commonest
# 3000 words all sit in a narrow frequency range. Splitting by *rank* instead
# gives a real progression in every language.
#
# The sizes grow, mirroring HSK 3.0 (500, 772, 973, 1000, 1071, 1140): early
# levels stay short so a beginner finishes one, later levels get longer as
# words become rarer and each is worth less.
LEVEL_SHARES = [0.08, 0.11, 0.14, 0.18, 0.22, 0.27]

# Words per unit. Small enough to finish in a sitting, which is the entire
# reason app curricula are chunked rather than presented as a list of 500.
UNIT_SIZE = 12


def download_hsk() -> Path:
    DATA.mkdir(parents=True, exist_ok=True)
    dest = DATA / "hsk30.csv"
    if not dest.exists():
        print("downloading HSK 3.0 list…")
        urllib.request.urlretrieve(HSK_URL, dest)
    return dest


def build_hsk() -> list:
    path = download_hsk()
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    entries = []
    seen = set()

    for r in rows:
        # HSK writes variants as "爸爸|爸". The first form is the headword;
        # keeping the pipe would break every dictionary lookup.
        word = (r.get("Simplified") or "").strip().split("|")[0]
        level_raw = (r.get("Level") or "").strip()
        if not word or not level_raw or word in seen:
            continue
        seen.add(word)
        # "7-9" is a single combined band in HSK 3.0, not three levels.
        level = 7 if level_raw.startswith("7") else int(level_raw)
        entries.append({
            "lang": "zh",
            "word": word,
            "level": level,
            "pinyin": (r.get("Pinyin") or "").strip().split("|")[0],
            "pos": (r.get("POS") or "").strip(),
            "standard": "HSK 3.0",
        })
    return entries


def build_frequency(language: str, limit: int = 3000) -> list:
    """Levels from corpus frequency, commonest first."""
    from wordfreq import get_frequency_dict

    freq = get_frequency_dict(language)
    # Zipf scale: log10(frequency per billion). Easier to band than raw counts.
    scored = sorted(
        ((w, math.log10(f) + 9) for w, f in freq.items()),
        key=lambda x: -x[1],
    )

    # Frequency alone puts particles and grammar words at the top: the first
    # Korean entry was 에서 and the first English one was "the". Nobody studies
    # those as vocabulary. Running each candidate through the same tokeniser
    # the rest of the app uses keeps only what it considers a content word, so
    # the curriculum and the clickable subtitles agree on what counts.
    from lemmatise import get_tokeniser
    tokenise = get_tokeniser(language)

    def is_vocabulary(word: str) -> bool:
        try:
            toks = tokenise(word)
        except Exception:
            return False
        # One token, and it has to be a content word. Anything that splits is
        # a phrase or a word plus an ending, not a headword.
        return len(toks) == 1 and toks[0].content

    usable = []
    for word, zipf in scored:
        # Single characters and stray punctuation are not vocabulary items.
        if len(word) < 2 and language != "zh":
            continue
        if not any(ch.isalpha() for ch in word):
            continue
        if not is_vocabulary(word):
            continue
        usable.append((word, zipf))
        if len(usable) >= limit:
            break

    # Cut the ranked list into levels by share, so every language gets the full
    # six regardless of how its frequencies happen to be distributed.
    entries = []
    start = 0
    for level, share in enumerate(LEVEL_SHARES, start=1):
        end = start + max(1, round(len(usable) * share))
        for word, zipf in usable[start:end]:
            entries.append({
                "lang": language,
                "word": word,
                "level": level,
                "zipf": round(zipf, 2),
                "standard": "frequency rank",
            })
        start = end
    # Rounding can leave a tail; it belongs in the last level.
    for word, zipf in usable[start:]:
        entries.append({
            "lang": language, "word": word, "level": len(LEVEL_SHARES),
            "zipf": round(zipf, 2), "standard": "frequency rank",
        })
    return entries


def store(db, entries: list, language: str) -> None:
    db.curriculum.delete_many({"lang": language})
    if not entries:
        return

    # Number within level so the UI can chunk into units without sorting the
    # whole level client side.
    by_level = {}
    for e in entries:
        idx = by_level.get(e["level"], 0)
        e["index"] = idx
        e["unit"] = idx // UNIT_SIZE
        by_level[e["level"]] = idx + 1

    for i in range(0, len(entries), 2000):
        db.curriculum.insert_many(entries[i:i + 2000])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", choices=["zh", "ko", "tr", "en"], default=None)
    ap.add_argument("--limit", type=int, default=3000,
                    help="words per frequency-based language")
    args = ap.parse_args()

    db = MongoClient(MONGO_URI).get_default_database()

    languages = [args.only] if args.only else ["zh", "ko", "tr", "en"]
    for lang in languages:
        if lang == "zh":
            entries = build_hsk()
        else:
            entries = build_frequency(lang, args.limit)
        store(db, entries, lang)
        levels = sorted({e["level"] for e in entries})
        print(f"  {lang}: {len(entries)} words, levels {levels}")

    db.curriculum.create_index([("lang", ASCENDING), ("level", ASCENDING),
                                ("index", ASCENDING)])
    db.curriculum.create_index([("lang", ASCENDING), ("word", ASCENDING)])
    print(f"\ntotal: {db.curriculum.count_documents({})}")


if __name__ == "__main__":
    main()
