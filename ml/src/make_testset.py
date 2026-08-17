"""Pull a handful of clips out of a downloaded FLEURS dev set.

FLEURS ships as one tarball of wavs plus a TSV of reference transcripts. This
picks N of them per language, copies the audio into data/samples/ and writes a
manifest pairing each file with its reference text.

The manifest is the point. Word-timing coverage can be measured against any
audio, but transcription *accuracy* needs ground truth, and that is the actual
research question. Keeping the reference alongside the clip from day 1 means
the error-rate work later does not need this step redone.

FLEURS is CC-BY-4.0 (Conneau et al., 2022) — attribution belongs in the report.

Usage:
    python src/make_testset.py --language ko --count 4
    python src/make_testset.py --language zh --count 4
"""

import argparse
import csv
import json
import tarfile
from pathlib import Path

DATA = Path(__file__).parent.parent / "data"
SAMPLES = DATA / "samples"

# FLEURS names its configs differently from the two-letter codes used elsewhere
# in this project.
CONFIGS = {"ko": "ko_kr", "zh": "cmn_hans_cn", "tr": "tr_tr"}

# The TSV has no header row. Columns are id, filename, raw transcription,
# normalised transcription, phonemes, samples, gender.
COL_FILENAME = 1
COL_RAW = 2


def load_references(tsv: Path) -> dict:
    refs = {}
    with tsv.open(encoding="utf-8") as f:
        for row in csv.reader(f, delimiter="\t"):
            if len(row) > COL_RAW:
                refs[row[COL_FILENAME]] = row[COL_RAW]
    return refs


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--language", required=True, choices=["ko", "zh", "tr"])
    ap.add_argument("--count", type=int, default=4)
    args = ap.parse_args()

    config = CONFIGS[args.language]
    tarball = DATA / "fleurs" / f"{config}_dev.tar.gz"
    tsv = DATA / "fleurs" / f"{config}_dev.tsv"

    for p in (tarball, tsv):
        if not p.exists():
            raise SystemExit(f"missing {p} — download the FLEURS dev set first")

    refs = load_references(tsv)
    out_dir = SAMPLES / f"fleurs_{args.language}"
    out_dir.mkdir(parents=True, exist_ok=True)

    entries = []
    with tarfile.open(tarball) as tar:
        members = (m for m in tar if m.isfile() and m.name.endswith(".wav"))
        for member in members:
            if len(entries) >= args.count:
                break
            name = Path(member.name).name
            reference = refs.get(name)
            if not reference:
                continue  # no ground truth, no use to us

            src = tar.extractfile(member)
            if src is None:
                continue
            dest = out_dir / name
            dest.write_bytes(src.read())

            entries.append({
                "file": str(dest.relative_to(SAMPLES.parent.parent)),
                "reference": reference,
                "language": args.language,
                "source": f"FLEURS {config} dev",
                "licence": "CC-BY-4.0",
                "speech_type": "read",  # studio-read sentences, not spontaneous
            })
            print(f"{name}  {reference[:60]}")

    manifest = out_dir / "manifest.json"
    manifest.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    print(f"\n{len(entries)} clips -> {out_dir}")
    print(f"manifest -> {manifest}")


if __name__ == "__main__":
    main()
