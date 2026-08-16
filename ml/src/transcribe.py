"""Video in, timestamped lemmatised JSON out.

The week-1 spike, now a thin wrapper over pipeline.Pipeline. Terminal only, no
API, no database — the point is to find out whether the pipeline produces word
timings good enough to cut clips from, before any interface gets built on top.

Runs on either machine. Picks CUDA when it is there (the 4090) and falls back to
CPU (the Mac) so the same script can be developed in one place and measured in
the other. Note that faster-whisper's backend has no Metal support, so on Apple
Silicon this is CPU regardless of MPS being available — use a small model there.

Usage:
    python src/transcribe.py data/samples/clip.mp4 --language ko
    python src/transcribe.py clip.mp4 --language zh --model large-v3
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pipeline import Pipeline


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video", type=Path)
    ap.add_argument("--language", required=True, choices=["ko", "zh"])
    ap.add_argument("--model", default="large-v3",
                    help="whisper model size; use 'small' or 'base' on CPU")
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    ap.add_argument("--script", default="simplified",
                    choices=["simplified", "traditional", "none"],
                    help="Chinese output script; ignored for Korean")
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    if not args.video.exists():
        sys.exit(f"no such file: {args.video}")

    try:
        pipe = Pipeline(args.language, args.model, args.device,
                        args.script, args.batch_size)
    except RuntimeError as e:
        sys.exit(f"\n{e}")

    print(f"transcribing {args.video.name}")
    result = pipe.run(args.video)

    out_path = args.out or Path("out") / (args.video.stem + ".json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2),
                        encoding="utf-8")

    cov, tim = result["coverage"], result["timing"]
    duration = result["audio_duration_sec"]
    print()
    print(f"word timing coverage: {cov['tokens_pct']}% of all tokens, "
          f"{cov['content_pct']}% of content words "
          f"({cov['content_with_timing']}/{cov['content_total']})")
    print(f"compute {tim['compute_sec']}s for {duration}s of audio "
          f"({tim['compute_realtime_factor']}x realtime), "
          f"{tim['total_sec']}s wall including model load")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
