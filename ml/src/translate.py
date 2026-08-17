"""English translation for the second subtitle track.

The brief lists dual English subtitles as a week-6 deliverable. Two ways to get
them, and the choice matters more than it looks:

1. **Whisper's own translate task.** Better English, but it re-segments the
   audio independently, so its lines do not correspond to the native lines. For
   dual subtitles that is the wrong shape — you would be matching two different
   segmentations by time overlap and getting partial sentences under each other.
   It also roughly doubles transcription time.

2. **A dedicated translation model over the existing segments.** Exactly one
   English line per native line, which is what a dual track needs, and fast
   enough to be free in practice.

This is option 2, using Marian (opus-mt), which is small — about 300 MB per
language pair — and runs on CPU in a second or two for a short clip.

The trade-off is honest: Marian's English is noticeably rougher than Whisper's,
especially for Korean. It is a reading aid for a learner who has the original in
front of them, not a translation to quote.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

MODELS = {
    "ko": "Helsinki-NLP/opus-mt-ko-en",
    "zh": "Helsinki-NLP/opus-mt-zh-en",
}

# Marian is trained on single sentences. Long inputs get truncated, so batches
# are kept small and sentences are sent whole rather than concatenated.
BATCH = 8
MAX_TOKENS = 512


class Translator:
    """Loads one Marian model. Reused across segments and across jobs."""

    def __init__(self, language: str, device: str = "cpu"):
        if language not in MODELS:
            raise ValueError(f"no translation model for {language!r}")

        from transformers import MarianMTModel, MarianTokenizer

        name = MODELS[language]
        self.language = language
        self.tokenizer = MarianTokenizer.from_pretrained(name)
        self.model = MarianMTModel.from_pretrained(name)
        # Marian is small enough that CPU is fine, and on this Mac CUDA does not
        # exist anyway. Kept configurable so the 4090 can use it.
        self.device = device
        self.model.to(device)
        self.model.eval()

    def __call__(self, texts: list[str]) -> list[str]:
        import torch

        out: list[str] = []
        for i in range(0, len(texts), BATCH):
            chunk = [t.strip() for t in texts[i:i + BATCH]]
            # Empty strings make Marian emit garbage rather than nothing, so
            # they are held out and restored afterwards.
            keep = [(j, t) for j, t in enumerate(chunk) if t]
            if not keep:
                out.extend([""] * len(chunk))
                continue

            batch = self.tokenizer(
                [t for _, t in keep], return_tensors="pt",
                padding=True, truncation=True, max_length=MAX_TOKENS,
            ).to(self.device)

            with torch.no_grad():
                generated = self.model.generate(**batch, max_length=MAX_TOKENS, num_beams=2)

            decoded = self.tokenizer.batch_decode(generated, skip_special_tokens=True)

            restored = [""] * len(chunk)
            for (j, _), text in zip(keep, decoded):
                restored[j] = text
            out.extend(restored)
        return out


def translate_segments(segments: list, language: str, device: str = "cpu",
                       translator: Translator | None = None) -> None:
    """Add an 'english' key to each segment, in place."""
    if not segments:
        return
    tr = translator or Translator(language, device)
    texts = [s.get("text", "") for s in segments]
    for seg, english in zip(segments, tr(texts)):
        seg["english"] = english
