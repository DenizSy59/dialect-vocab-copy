"""Measure transcription accuracy, and where the errors land.

The research question is not "how accurate is Whisper" — plenty of papers answer
that. It is whether the errors fall on the words a learner actually wants to
save. A 92% accurate subtitle is useless if the missing 8% is exactly the
unfamiliar vocabulary.

So this reports the usual character and word error rates, and then splits the
errors by whether the reference token was a content word (noun, verb, adjective,
adverb — the things you would put on a flashcard) or a function word (particles,
endings, punctuation — the things you would not).

The headline number is the concentration ratio at the bottom: the share of
errors landing on content words divided by the share of tokens that are content
words. Above 1.0 means errors cluster on exactly the words that matter.

Needs a test set with reference transcripts, so FLEURS rather than the Commons
clips.

Usage:
    python src/evaluate.py --language ko --model small
    python src/evaluate.py --language zh --model small --limit 10
"""

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pipeline import Pipeline
from lemmatise import get_tokeniser

DATA = Path(__file__).parent.parent / "data"
OUT = Path(__file__).parent.parent / "out"

# Punctuation in both scripts. Whisper's punctuation is inconsistent — Chinese
# output frequently drops it entirely — and a learner does not care, so it is
# stripped before comparison rather than counted as an error.
PUNCT = re.compile(r"[\s。，、！？；：（）「」『』〈〉《》—…·.,!?;:()\[\]{}\"'`~\-–—]+")
PUNCT_KEEP_SPACE = re.compile(r"[。，、！？；：（）「」『』〈〉《》—…·.,!?;:()\[\]{}\"'`~\-–—]+")

# Languages whose words are separated by spaces. For these the space is a word
# boundary and removing it destroys the tokenisation; for Korean and Chinese it
# is noise — Whisper's spacing differs from the reference constantly and the
# tokenisers do not depend on it.
SPACE_DELIMITED = {"tr"}


def normalise(text: str, language: str = "ko") -> str:
    """Fold away differences that are not transcription errors.

    Deliberately does NOT normalise numbers. FLEURS references spell them out
    (이백만) while Whisper writes digits (200만), which inflates the error rate.
    Fixing that properly needs a number-to-words pass per language; until then
    the rates here are pessimistic and that is the safer direction to be wrong in.
    """
    text = unicodedata.normalize("NFKC", text)
    if language in SPACE_DELIMITED:
        # Strip punctuation but keep one space between words, then collapse.
        return re.sub(r"\s+", " ", PUNCT_KEEP_SPACE.sub(" ", text)).strip().lower()
    return PUNCT.sub("", text).lower()


def align(ref: list, hyp: list) -> list:
    """Levenshtein alignment over token lists.

    Returns (op, ref_index, hyp_index) with op in equal/sub/del/ins and None for
    the index that does not apply. Written out rather than pulled from a library
    because the error attribution below needs the reference index for every
    operation, which the usual WER helpers do not hand back cleanly.
    """
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)

    ops, i, j = [], n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (0 if ref[i - 1] == hyp[j - 1] else 1):
            ops.append(("equal" if ref[i - 1] == hyp[j - 1] else "sub", i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            ops.append(("del", i - 1, None))
            i -= 1
        else:
            ops.append(("ins", None, j - 1))
            j -= 1
    ops.reverse()
    return ops


def cer(ref: str, hyp: str) -> tuple[int, int]:
    """Character errors and reference length, for pooling across clips."""
    ops = align(list(ref), list(hyp))
    errors = sum(1 for op, _, _ in ops if op != "equal")
    return errors, len(ref)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--language", required=True, choices=["ko", "zh", "tr"])
    ap.add_argument("--model", default="small")
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    manifest_path = DATA / "samples" / f"fleurs_{args.language}" / "manifest.json"
    if not manifest_path.exists():
        sys.exit(f"no test set at {manifest_path} — run make_testset.py first")

    entries = json.loads(manifest_path.read_text(encoding="utf-8"))
    if args.limit:
        entries = entries[:args.limit]

    pipe = Pipeline(args.language, args.model, args.device, quiet=False)
    tokenise = get_tokeniser(args.language)

    char_err = char_len = 0
    tok_err = tok_len = 0
    content_total = content_err = 0
    function_total = function_err = 0
    insertions = 0
    audio_sec = compute_sec = 0.0
    per_clip = []

    for n, entry in enumerate(entries, 1):
        path = Path(__file__).parent.parent.parent / entry["file"]
        if not path.exists():
            path = DATA.parent / entry["file"]
        result = pipe.run(path)

        hypothesis = normalise(" ".join(s["text"] for s in result["segments"]), args.language)
        reference = normalise(entry["reference"], args.language)

        e, l = cer(reference, hypothesis)
        char_err += e
        char_len += l

        # Token-level attribution. Both sides go through the same tokeniser so
        # the comparison is like for like; content flags come from the
        # reference, since that is the ground truth about what kind of word it
        # was meant to be.
        ref_tokens = tokenise(reference)
        hyp_tokens = tokenise(hypothesis)
        ref_surfaces = [t.surface for t in ref_tokens]
        hyp_surfaces = [t.surface for t in hyp_tokens]

        for op, ri, _ in align(ref_surfaces, hyp_surfaces):
            if op == "ins":
                insertions += 1
                tok_err += 1
                continue
            is_content = ref_tokens[ri].content
            if is_content:
                content_total += 1
            else:
                function_total += 1
            if op != "equal":
                tok_err += 1
                if is_content:
                    content_err += 1
                else:
                    function_err += 1
        tok_len += len(ref_surfaces)

        audio_sec += result["audio_duration_sec"]
        compute_sec += result["timing"]["compute_sec"]

        per_clip.append({
            "file": entry["file"],
            "reference": entry["reference"],
            "hypothesis": " ".join(s["text"] for s in result["segments"]),
            "cer": round(e / l, 4) if l else None,
            "coverage_content_pct": result["coverage"]["content_pct"],
        })
        print(f"  [{n}/{len(entries)}] cer {e / l:.3f}" if l else "")

    def rate(a, b):
        return round(a / b, 4) if b else None

    def fmt(x):
        # A rate can legitimately be undefined — a language with no function
        # words in the sample, say — and that should print as n/a rather than
        # crashing after twenty clips of compute.
        return f"{x:.3f}" if x is not None else "n/a"

    content_rate = rate(content_err, content_total)
    function_rate = rate(function_err, function_total)

    # The headline. Share of errors landing on content words, over the share of
    # tokens that are content words. 1.0 means errors are spread evenly; above
    # 1.0 means they cluster on the words a learner would save.
    attributable = content_err + function_err
    attributable_total = content_total + function_total
    concentration = None
    if attributable and attributable_total:
        err_share = content_err / attributable
        tok_share = content_total / attributable_total
        concentration = round(err_share / tok_share, 3) if tok_share else None

    summary = {
        "language": args.language,
        "model": args.model,
        "device": pipe.device,
        "clips": len(entries),
        "audio_sec": round(audio_sec, 1),
        "compute_sec": round(compute_sec, 1),
        "compute_realtime_factor": rate(compute_sec, audio_sec),
        "cer": rate(char_err, char_len),
        "token_error_rate": rate(tok_err, tok_len),
        "content_token_error_rate": content_rate,
        "function_token_error_rate": function_rate,
        "content_tokens": content_total,
        "function_tokens": function_total,
        "insertions": insertions,
        "error_concentration_on_content": concentration,
        "per_clip": per_clip,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    out_path = OUT / f"eval_{args.language}_{args.model}.json"
    out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2),
                        encoding="utf-8")

    print()
    print(f"{args.language} / {args.model} / {len(entries)} clips / {audio_sec:.0f}s audio")
    print(f"  character error rate      {fmt(summary['cer'])}")
    print(f"  token error rate          {fmt(summary['token_error_rate'])}")
    print(f"  content-word error rate   {fmt(content_rate)}  ({content_total} tokens)")
    print(f"  function-word error rate  {fmt(function_rate)}  ({function_total} tokens)")
    print(f"  error concentration       {concentration}x  (>1 = errors cluster on content words)")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
