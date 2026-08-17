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

# Into English. These are the well-trained direction for all three languages.
MODELS = {
    "ko": "Helsinki-NLP/opus-mt-ko-en",
    "zh": "Helsinki-NLP/opus-mt-zh-en",
    "tr": "Helsinki-NLP/opus-mt-tr-en",
}

# Out of English. Needed because a learner whose English is weak should not be
# forced to read the second subtitle track in a third language.
FROM_ENGLISH = {
    "tr": "Helsinki-NLP/opus-mt-tc-big-en-tr",
    "zh": "Helsinki-NLP/opus-mt-en-zh",
    "ko": "Helsinki-NLP/opus-mt-tc-big-en-ko",
}

# Every language this can translate into.
TARGETS = ("en", "tr", "zh", "ko")

# Marian is trained on single sentences. Long inputs get truncated, so batches
# are kept small and sentences are sent whole rather than concatenated.
BATCH = 8
MAX_TOKENS = 512


class Translator:
    """Loads one Marian model. Reused across segments and across jobs."""

    def __init__(self, language: str = None, device: str = "cpu",
                 source: str = None, target: str = "en"):
        # Two call shapes: Translator("ko") for the common into-English case,
        # and Translator(source="en", target="tr") for the reverse direction.
        language = language or source
        if target == "en":
            if language not in MODELS:
                raise ValueError(f"no translation model for {language!r}")
            name = MODELS[language]
        else:
            if target not in FROM_ENGLISH:
                raise ValueError(f"no translation model into {target!r}")
            name = FROM_ENGLISH[target]

        from transformers import MarianMTModel, MarianTokenizer

        self.language = language
        self.target = target
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


class PivotTranslator:
    """Translate into a language that has no direct model from the source.

    No opus-mt model exists for ko→tr, zh→tr or tr→ko, so those go through
    English in two hops. This costs quality — every error in the first hop is
    carried into the second and restated fluently — and that is why English
    stays the default. It is still better than forcing someone to read a
    language they do not know.
    """

    def __init__(self, source: str, target: str, device: str = "cpu"):
        self.source = source
        self.target = target
        self.to_english = Translator(source, device)
        self.from_english = Translator(source="en", device=device, target=target)

    def __call__(self, texts: list[str]) -> list[str]:
        return self.from_english(self.to_english(texts))


def build_translator(source: str, target: str = "en", device: str = "cpu"):
    """Pick the shortest available route from source to target."""
    if target == source:
        return None
    if target == "en":
        return Translator(source, device)
    if source == "en":
        return Translator(source="en", device=device, target=target)
    return PivotTranslator(source, target, device)


def translate_segments(segments: list, language: str, device: str = "cpu",
                       translator=None, target: str = "en") -> None:
    """Add a 'translation' key to each segment, in place.

    'english' is kept alongside it so existing data and the Anki export do not
    break when the target is something else.
    """
    if not segments:
        return
    tr = translator or build_translator(language, target, device)
    if tr is None:
        return
    texts = [s.get("text", "") for s in segments]
    for seg, translated in zip(segments, tr(texts)):
        seg["translation"] = translated
        if target == "en":
            seg["english"] = translated
