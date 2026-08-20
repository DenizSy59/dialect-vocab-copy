"""Reorder dictionary senses so the common meaning comes first.

The app takes `senses[0]` everywhere — the word panel, the deck, quiz answers,
the Anki export. That made sense ordering a correctness problem rather than a
cosmetic one, and the ordering we inherited is wrong often enough to matter:

    시장  ->  hunger, market, mayor        (it means *market*)
    行    ->  row; line, trade, firm       (it means *to walk* / *OK*)

Wiktionary lists senses by etymology and CC-CEDICT by whatever the contributor
wrote first. Neither is ordered by how likely a learner is to meet the sense.

There is no frequency data per *sense*, so this cannot be solved properly
without sense-annotated corpora. What it does instead is score each gloss on
signals that correlate with being the everyday meaning, and it is a heuristic —
it will get some words wrong, and it only reorders, never discards, so the other
senses remain one line down.

Usage:
    python src/rank_senses.py            # all languages
    python src/rank_senses.py --only ko
"""

import argparse
import os
import re

from pymongo import MongoClient

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://127.0.0.1:27017/dialect_vocab")

# Glosses that are notes about the word rather than what it means. These are
# the only thing this file claims to identify, and it can do so reliably.
NOT_A_MEANING = re.compile(
    r"^\s*(also\s+pr\.|pronounced|old variant|erhua variant|Taiwan pr\.|"
    r"also written|abbr\. for|used in)\b",
    re.I,
)

# Grammatical notes rather than meanings.
FORM_OF = re.compile(r"\b(form of|alternative (form|spelling)|abbreviation of|"
                     r"contraction of|classifier for)\b", re.I)


def score(gloss: str, position: int) -> float:
    """Higher is more likely to be a meaning at all. Deliberately conservative.

    An earlier version tried to rank real meanings against each other using
    gloss length and specialist labels. It did not work, and the dry run showed
    why: it never fixed 시장 (hunger before market) because nothing in the text
    distinguishes them, while it *did* break 会 by promoting "meeting" over "can,
    to know how to". Ranking meanings needs per-sense frequency data, which does
    not exist openly for these languages.

    So this only demotes glosses that are provably not meanings — pronunciation
    notes, cross-references, form-of entries. Those it can identify with
    certainty, and demoting them is always an improvement. Everything else keeps
    the source order.
    """
    s = -position * 0.01  # preserve source order among real meanings

    if NOT_A_MEANING.match(gloss):
        s -= 10.0
    if gloss.startswith("CL:") or gloss.startswith("see "):
        s -= 8.0
    if FORM_OF.search(gloss):
        s -= 6.0
    if "variant of" in gloss.lower():
        s -= 6.0

    return s


def rerank(senses: list) -> list:
    ordered = sorted(
        ((g, i) for i, g in enumerate(senses)),
        key=lambda x: -score(x[0], x[1]),
    )
    return [g for g, _ in ordered]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", choices=["zh", "ko", "tr"], default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    db = MongoClient(MONGO_URI).get_default_database()
    query = {"lang": args.only} if args.only else {}

    changed = 0
    total = 0
    from pymongo import UpdateOne
    batch = []

    for row in db.dictionary.find(query, {"senses": 1, "word": 1}):
        senses = row.get("senses") or []
        total += 1
        if len(senses) < 2:
            continue
        new = rerank(senses)
        if new == senses:
            continue
        changed += 1
        if args.dry_run:
            if changed <= 12:
                print(f"  {row['word']}: {senses[0][:34]!r} -> {new[0][:34]!r}")
            continue
        batch.append(UpdateOne({"_id": row["_id"]}, {"$set": {"senses": new}}))
        if len(batch) >= 2000:
            db.dictionary.bulk_write(batch, ordered=False)
            batch = []

    if batch:
        db.dictionary.bulk_write(batch, ordered=False)

    print(f"\n  {changed} of {total} entries reordered"
          f"{' (dry run, nothing written)' if args.dry_run else ''}")


if __name__ == "__main__":
    main()
