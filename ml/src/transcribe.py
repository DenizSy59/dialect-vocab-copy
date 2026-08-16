"""Video in, timestamped lemmatised JSON out.

The week-1 spike. Terminal only, no API, no database — the point is to find out
whether the pipeline produces word timings good enough to cut clips from, before
any interface gets built on top of it.

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
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lemmatise import get_tokeniser, Token


def pick_device(requested: str) -> tuple[str, str]:
    """Return (device, compute_type).

    float16 on a real GPU, int8 on CPU — float32 on CPU is slow enough to make
    a long clip untestable, and int8 costs little accuracy for this purpose.
    """
    import torch

    if requested != "auto":
        device = requested
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"

    if device == "cuda":
        name = torch.cuda.get_device_name(0)
        print(f"device: cuda ({name})")
        return "cuda", "float16"

    print("device: cpu (no CUDA — expect this to be slow)")
    return "cpu", "int8"


def extract_audio(video: Path) -> Path:
    """16 kHz mono wav, which is what Whisper wants anyway."""
    out = Path(tempfile.mkdtemp()) / "audio.wav"
    cmd = [
        "ffmpeg", "-nostdin", "-loglevel", "error", "-y",
        "-i", str(video),
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
        str(out),
    ]
    subprocess.run(cmd, check=True)
    return out


def media_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def word_spans(text: str, words: list) -> list:
    """Locate each aligned word inside the segment text.

    WhisperX returns words in order but no character offsets, and for Chinese it
    returns one entry per character while Korean comes back per spacing unit.
    Walking the string forward handles both and keeps duplicates in the right
    place — searching from the start would match the first occurrence every time.
    """
    spans = []
    cursor = 0
    for w in words:
        surface = (w.get("word") or "").strip()
        if not surface:
            continue
        idx = text.find(surface, cursor)
        if idx == -1:
            continue
        spans.append((idx, idx + len(surface), w.get("start"), w.get("end")))
        cursor = idx + len(surface)
    return spans


def attach_timings(tokens: list[Token], spans: list) -> None:
    """Give each token the time range of the aligned words it overlaps.

    A token can span several aligned words (a Chinese two-character word) or sit
    inside one (a Korean particle split off an eojeol), so take the earliest
    start and latest end of everything it touches.
    """
    for tok in tokens:
        starts, ends = [], []
        for s_char, e_char, s_t, e_t in spans:
            overlaps = tok.char_start < e_char and s_char < tok.char_end
            if overlaps and s_t is not None and e_t is not None:
                starts.append(s_t)
                ends.append(e_t)
        if starts:
            tok.start = min(starts)
            tok.end = max(ends)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video", type=Path)
    ap.add_argument("--language", required=True, choices=["ko", "zh"])
    ap.add_argument("--model", default="large-v3",
                    help="whisper model size; use 'small' or 'base' on CPU")
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    if not args.video.exists():
        sys.exit(f"no such file: {args.video}")

    import whisperx

    device, compute_type = pick_device(args.device)
    started = time.time()

    print(f"extracting audio from {args.video.name}")
    audio_path = extract_audio(args.video)
    duration = media_duration(audio_path)
    print(f"audio: {duration:.1f}s")

    print(f"loading whisper {args.model}")
    model = whisperx.load_model(
        args.model, device, compute_type=compute_type, language=args.language,
    )
    audio = whisperx.load_audio(str(audio_path))

    print("transcribing")
    t0 = time.time()
    result = model.transcribe(audio, batch_size=args.batch_size)
    transcribe_sec = time.time() - t0
    print(f"transcribed in {transcribe_sec:.1f}s, {len(result['segments'])} segments")

    # Force alignment is the whole reason for WhisperX over plain Whisper.
    # Segment-level timings are not precise enough to highlight a word or cut a
    # clip, so if this step has no model for the language the clip feature is in
    # trouble and we want to know on day 1, not in week 4.
    print("loading alignment model")
    try:
        align_model, metadata = whisperx.load_align_model(
            language_code=args.language, device=device,
        )
    except Exception as e:
        sys.exit(
            f"\nno alignment model for {args.language!r}: {e}\n"
            "Without force alignment there are no word timings, so clips cannot\n"
            "be cut. This is open question 1 — report it before going further."
        )

    print("aligning to word level")
    t0 = time.time()
    result = whisperx.align(
        result["segments"], align_model, metadata, audio, device,
        return_char_alignments=False,
    )
    align_sec = time.time() - t0
    print(f"aligned in {align_sec:.1f}s")

    tokenise = get_tokeniser(args.language)

    segments = []
    total_tokens = timed_tokens = 0
    total_content = timed_content = 0

    for i, seg in enumerate(result["segments"]):
        text = seg.get("text", "").strip()
        if not text:
            continue
        words = seg.get("words", [])
        spans = word_spans(text, words)
        tokens = tokenise(text)
        attach_timings(tokens, spans)

        for tok in tokens:
            total_tokens += 1
            if tok.start is not None:
                timed_tokens += 1
            if tok.content:
                total_content += 1
                if tok.start is not None:
                    timed_content += 1

        segments.append({
            "id": i,
            "start": seg.get("start"),
            "end": seg.get("end"),
            "text": text,
            "words": [
                {"word": w.get("word"), "start": w.get("start"),
                 "end": w.get("end"), "score": w.get("score")}
                for w in words
            ],
            "tokens": [t.to_dict() for t in tokens],
        })

    def pct(n, d):
        return round(100.0 * n / d, 1) if d else 0.0

    # Open question 1: above 90% is good, below 80% means clips will cut
    # mid-word and the feature needs rethinking. Content-word coverage is the
    # number that actually matters — those are the words a learner saves.
    coverage = {
        "tokens_total": total_tokens,
        "tokens_with_timing": timed_tokens,
        "tokens_pct": pct(timed_tokens, total_tokens),
        "content_total": total_content,
        "content_with_timing": timed_content,
        "content_pct": pct(timed_content, total_content),
    }

    elapsed = time.time() - started
    output = {
        "source": str(args.video),
        "language": args.language,
        "model": args.model,
        "device": device,
        "compute_type": compute_type,
        "audio_duration_sec": round(duration, 2),
        "timing": {
            "transcribe_sec": round(transcribe_sec, 2),
            "align_sec": round(align_sec, 2),
            "total_sec": round(elapsed, 2),
            "realtime_factor": round(elapsed / duration, 2) if duration else None,
        },
        "coverage": coverage,
        "segments": segments,
    }

    out_path = args.out or Path("out") / (args.video.stem + ".json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    print()
    print(f"word timing coverage: {coverage['tokens_pct']}% of all tokens, "
          f"{coverage['content_pct']}% of content words "
          f"({timed_content}/{total_content})")
    print(f"took {elapsed:.1f}s for {duration:.1f}s of audio "
          f"({elapsed / duration:.2f}x realtime)" if duration else "")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
