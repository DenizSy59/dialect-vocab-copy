"""Load Chinese and Korean dictionaries into MongoDB.

A saved word without a meaning is a bad flashcard. Until this existed the Anki
export shipped the word, its sentence and a timestamp, and the learner still had
to go look up what it meant — which is most of the work the app was supposed to
save them.

Sources, both freely licensed and both needing attribution in the report:

- **CC-CEDICT** — Chinese-English, CC BY-SA 4.0, from MDBG. Plain text, one
  entry per line, traditional and simplified plus pinyin.
- **Wiktionary via kaikki.org** — Korean, CC BY-SA 3.0, machine-readable JSONL
  extract of the English Wiktionary's Korean entries.

Run once. Re-running replaces the collection.

Usage:
    python src/build_dictionary.py
    python src/build_dictionary.py --only zh
"""

import argparse
import gzip
import json
import os
import re
from pathlib import Path

from pymongo import MongoClient, ASCENDING

DICT_DIR = Path(__file__).parent.parent / "data" / "dict"
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://127.0.0.1:27017/dialect_vocab")

# Keep a handful of senses. Wiktionary can carry dozens for a common word and a
# flashcard that lists all of them teaches nothing.
MAX_SENSES = 4

# CC-CEDICT line: 傳統 传统 [chuan2 tong3] /tradition/traditional/
CEDICT_LINE = re.compile(r"^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+/(.*)/\s*$")


def load_cedict(path: Path) -> list:
    entries = {}
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            m = CEDICT_LINE.match(line.rstrip("\n"))
            if not m:
                continue
            traditional, simplified, pinyin, glosses = m.groups()
            senses = [g for g in glosses.split("/") if g]
            if not senses:
                continue

            # Keyed on simplified, since the pipeline normalises output to
            # simplified. Traditional is kept as an alias so a traditional
            # source still resolves.
            for key in {simplified, traditional}:
                row = entries.setdefault(key, {
                    "lang": "zh", "word": key, "pinyin": pinyin, "senses": [],
                })
                for s in senses:
                    if s not in row["senses"]:
                        row["senses"].append(s)

    for row in entries.values():
        row["senses"] = row["senses"][:MAX_SENSES]
    return list(entries.values())


def load_kaikki(path: Path) -> list:
    """Korean, from the Wiktionary JSONL extract.

    Streamed line by line — the file is about 200 MB and this machine has 8 GB,
    so loading it whole would be careless.
    """
    entries = {}
    with path.open(encoding="utf-8") as f:
        for line in f:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue

            word = row.get("word")
            if not word:
                continue

            glosses = []
            for sense in row.get("senses", []):
                for g in sense.get("glosses", []) or []:
                    # Wiktionary marks inflected forms as "past tense of X".
                    # Those are noise here: the pipeline already lemmatised, so
                    # a form-of entry means the lookup landed on the wrong key.
                    if g and not re.match(r"^\s*(inflected|past|present|future)\b.*\bof\b", g, re.I):
                        glosses.append(g)

            if not glosses:
                continue

            entry = entries.setdefault(word, {
                "lang": "ko", "word": word, "pos": row.get("pos", ""), "senses": [],
            })
            for g in glosses:
                if g not in entry["senses"]:
                    entry["senses"].append(g)

    for row in entries.values():
        row["senses"] = row["senses"][:MAX_SENSES]
    return list(entries.values())


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", choices=["zh", "ko"], default=None)
    args = ap.parse_args()

    db = MongoClient(MONGO_URI).get_default_database()

    jobs = []
    if args.only in (None, "zh"):
        jobs.append(("zh", DICT_DIR / "cedict.txt.gz", load_cedict))
    if args.only in (None, "ko"):
        jobs.append(("ko", DICT_DIR / "kaikki-ko.jsonl", load_kaikki))

    for lang, path, loader in jobs:
        if not path.exists():
            print(f"!! missing {path} — skipped")
            continue
        print(f"parsing {path.name}")
        rows = loader(path)
        print(f"  {len(rows)} entries")

        db.dictionary.delete_many({"lang": lang})
        for i in range(0, len(rows), 5000):
            db.dictionary.insert_many(rows[i:i + 5000])
        print(f"  loaded into mongo")

    # Compound index because every lookup is (language, word) — without it this
    # is a collection scan on hundreds of thousands of rows per click.
    db.dictionary.create_index([("lang", ASCENDING), ("word", ASCENDING)])
    print(f"\ntotal entries: {db.dictionary.count_documents({})}")


if __name__ == "__main__":
    main()
