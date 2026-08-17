"""The transcription pipeline as a reusable object.

transcribe.py runs this once for one file. evaluate.py runs it over a whole test
set, which is why the models live on the object: loading whisper and the
wav2vec2 aligner takes longer than transcribing a short clip, so reloading them
per file made a model sweep take longer than it needed to.

This is also roughly the shape the Python worker wants later — load once, then
handle jobs off the queue.
"""

import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional

from lemmatise import get_tokeniser, Token
from difficulty import score_all
from dialect import detect, annotate_segments
from translate import translate_segments


def pick_device(requested: str = "auto") -> tuple[str, str]:
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
        return "cuda", "float16"
    return "cpu", "int8"


def device_label(device: str) -> str:
    import torch
    if device == "cuda":
        return f"cuda ({torch.cuda.get_device_name(0)})"
    return "cpu (no CUDA — expect this to be slow)"


def extract_audio(video: Path) -> Path:
    """16 kHz mono wav, which is what Whisper wants anyway."""
    out = Path(tempfile.mkdtemp()) / "audio.wav"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(video),
         "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(out)],
        check=True,
    )
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


def attach_timings(tokens: list, spans: list) -> None:
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


SUPPORTED = ("ko", "zh", "tr")

# Detection only needs to tell a handful of languages apart, and it listens to
# the opening seconds, so the smallest model is enough. Cached because it is
# loaded once per worker and then used for every auto-language job.
_detect_model = None


def detect_language(video: Path, device: str | None = None) -> tuple[str, float]:
    """Identify the spoken language. Returns (code, probability).

    Asking the user to pick the language is a question the software can answer
    itself, and getting it wrong is obvious in the output, so this is a safe
    thing to automate — with the picker still there as an override.
    """
    global _detect_model
    import whisperx

    dev, compute = pick_device(device or "auto")
    if _detect_model is None:
        _detect_model = whisperx.load_model("tiny", dev, compute_type=compute)

    audio_path = extract_audio(Path(video))
    audio = whisperx.load_audio(str(audio_path))
    # faster-whisper exposes the detector under the wrapped model.
    inner = getattr(_detect_model, "model", _detect_model)
    language, probability, _ = inner.detect_language(audio)
    return language, float(probability)


class ScriptNormaliser:
    """Force Chinese output to one script.

    Whisper returns traditional or simplified more or less at whim — the 湖口话
    clip switched between them mid-transcript. A learner studying one script
    gets dictionary misses and inconsistent saved vocabulary from the other, so
    this is a correctness fix, not cosmetics.

    Defaults to simplified: it is the mainland standard, what most Mandarin
    learners study, and what the FLEURS references use, so comparisons stay
    meaningful. Change with --script if that is wrong for you.
    """

    def __init__(self, target: str = "simplified"):
        self.target = target
        self.convert = None
        if target in ("simplified", "traditional"):
            import opencc
            self.convert = opencc.OpenCC("t2s" if target == "simplified" else "s2t").convert

    def __call__(self, text: str) -> str:
        return self.convert(text) if self.convert else text


class Pipeline:
    """Loads whisper and the aligner once, then processes any number of files."""

    def __init__(self, language: str, model: str = "large-v3",
                 device: str = "auto", script: str = "simplified",
                 batch_size: int = 16, quiet: bool = False,
                 translate: bool = True):
        import whisperx

        self.language = language
        self.model_name = model
        self.batch_size = batch_size
        self.device, self.compute_type = pick_device(device)
        self.quiet = quiet

        self._log(f"device: {device_label(self.device)}")
        self._log(f"loading whisper {model}")
        self.model = whisperx.load_model(
            model, self.device, compute_type=self.compute_type, language=language,
        )

        # Force alignment is the whole reason for WhisperX over plain Whisper.
        # Segment-level timings cannot highlight a word or cut a clip.
        self._log("loading alignment model")
        try:
            self.align_model, self.align_meta = whisperx.load_align_model(
                language_code=language, device=self.device,
            )
        except Exception as e:
            raise RuntimeError(
                f"no alignment model for {language!r}: {e}\n"
                "Without force alignment there are no word timings, so clips "
                "cannot be cut."
            ) from e

        self.tokenise = get_tokeniser(language)
        # Only Chinese needs script normalising; Korean has one script.
        self.normalise = ScriptNormaliser(script if language == "zh" else "none")

        # Loaded eagerly so the cost lands at worker startup rather than in the
        # middle of the first job, where it would look like a stall.
        self.translator = None
        if translate:
            try:
                from translate import Translator
                self._log("loading translation model")
                self.translator = Translator(language, self.device)
            except Exception as e:
                # A missing translation model must not take the transcript with
                # it — English subtitles are an addition, not the product.
                self._log(f"translation unavailable, continuing without it: {e}")

    def _log(self, msg: str):
        if not self.quiet:
            print(msg)

    def run(self, video: Path) -> dict:
        import whisperx

        started = time.time()
        audio_path = extract_audio(Path(video))
        duration = media_duration(audio_path)
        audio = whisperx.load_audio(str(audio_path))

        t0 = time.time()
        result = self.model.transcribe(audio, batch_size=self.batch_size)
        transcribe_sec = time.time() - t0

        t0 = time.time()
        result = whisperx.align(
            result["segments"], self.align_model, self.align_meta, audio,
            self.device, return_char_alignments=False,
        )
        align_sec = time.time() - t0

        segments = []
        total = timed = total_content = timed_content = 0

        for i, seg in enumerate(result["segments"]):
            text = self.normalise(seg.get("text", "").strip())
            if not text:
                continue
            # Words are normalised too, otherwise the character offsets used to
            # attach timings will not line up with the normalised text.
            words = [{**w, "word": self.normalise(w.get("word") or "")}
                     for w in seg.get("words", [])]
            spans = word_spans(text, words)
            tokens = self.tokenise(text)
            attach_timings(tokens, spans)

            for tok in tokens:
                total += 1
                timed += tok.start is not None
                if tok.content:
                    total_content += 1
                    timed_content += tok.start is not None

            segments.append({
                "id": i,
                "start": seg.get("start"),
                "end": seg.get("end"),
                "text": text,
                "english": "",  # filled in below when translation is enabled
                "words": [{"word": w.get("word"), "start": w.get("start"),
                           "end": w.get("end"), "score": w.get("score")}
                          for w in words],
                "tokens": [t.to_dict() for t in tokens],
            })

        # Difficulty needs the finished tokens, so it runs after the loop rather
        # than inside it. Cheap compared to everything above — a dictionary
        # lookup per content word.
        score_all(segments, self.language)
        annotate_segments(segments, self.language)
        dialect_result = detect(segments, self.language)

        translate_sec = 0.0
        if self.translator is not None:
            t0 = time.time()
            translate_segments(segments, self.language, translator=self.translator)
            translate_sec = time.time() - t0

        def pct(n, d):
            return round(100.0 * n / d, 1) if d else 0.0

        elapsed = time.time() - started
        return {
            "source": str(video),
            "language": self.language,
            "model": self.model_name,
            "device": self.device,
            "compute_type": self.compute_type,
            "audio_duration_sec": round(duration, 2),
            # total_sec includes model load on a cold cache and says nothing
            # about the pipeline; compute_sec is the comparable number.
            "timing": {
                "transcribe_sec": round(transcribe_sec, 2),
                "align_sec": round(align_sec, 2),
                "translate_sec": round(translate_sec, 2),
                "compute_sec": round(transcribe_sec + align_sec, 2),
                "total_sec": round(elapsed, 2),
                "compute_realtime_factor": (
                    round((transcribe_sec + align_sec) / duration, 2) if duration else None
                ),
            },
            # Open question 1: above 90% is good, below 80% means clips will cut
            # mid-word. Content-word coverage is the number that matters, since
            # those are the words a learner saves.
            "dialect": dialect_result,
            "coverage": {
                "tokens_total": total,
                "tokens_with_timing": timed,
                "tokens_pct": pct(timed, total),
                "content_total": total_content,
                "content_with_timing": timed_content,
                "content_pct": pct(timed_content, total_content),
            },
            "segments": segments,
        }
