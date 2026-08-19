"""Tokenising and lemmatising for Chinese and Korean.

Chinese has no inflection, so the lemma is the surface form and the only real
work is word segmentation. Korean is agglutinative, so 먹었어요 has to come back
as 먹다 or a saved vocabulary card is useless.

Both tokenisers report character offsets into the segment text. transcribe.py
uses those offsets to attach word-level timings, so they must be accurate.
"""

from dataclasses import dataclass, asdict
from typing import List, Optional


# Parts of speech worth saving as vocabulary. Particles, endings and
# punctuation are filtered out — a learner does not save 을/를 as a word.
# SL (foreign script) is deliberately excluded. Latin-script tokens like "FC"
# and "AI" were being offered as Korean vocabulary, which is noise — a learner
# already reads them. Loanwords written in hangul are tagged NNG and still count.
KIWI_CONTENT_TAGS = {"NNG", "NNP", "NNB", "NR", "VV", "VA", "VX", "MAG", "MAJ", "XR"}
JIEBA_CONTENT_TAGS = {"n", "nr", "ns", "nt", "nz", "v", "vd", "vn", "a", "ad", "an", "d", "i", "l", "s", "t"}

# Korean predicate tags. Kiwi gives the bare stem for these, so the dictionary
# form is stem + 다.
KIWI_VERBAL_TAGS = {"VV", "VA", "VX", "VCP", "VCN"}


@dataclass
class Token:
    surface: str        # as it appears in the transcript
    lemma: str          # dictionary form, what gets saved
    pos: str
    char_start: int     # offset into the segment text
    char_end: int
    content: bool       # worth offering as a vocabulary item
    start: Optional[float] = None   # filled in later from word timings
    end: Optional[float] = None

    def to_dict(self):
        return asdict(self)


def merge_proper_nouns(tokens: List[Token]) -> List[Token]:
    """Glue a proper noun back onto the syllable kiwi split off it.

    Names outside kiwi's dictionary get broken up: 손호준 comes back as
    손호/NNP + 준/NNG, so clicking the name in the app saved only 손호. Merging an
    NNP with a directly following noun fixes that.

    Contiguity is what keeps this safe. 한국 사람 has a space between the tokens
    so it is left alone, and a particle after a name (박지성/NNP + 과/JC) is not a
    noun so it is left alone too.

    This does not rescue names kiwi fails to see as names at all — 이한범 comes
    back as 이/MM + 한/MM + 범/NNG, with no proper noun to anchor to. That case
    needs a real NER pass and is still open.
    """
    merged: List[Token] = []
    for tok in tokens:
        prev = merged[-1] if merged else None
        joinable = (
            prev is not None
            and prev.pos == "NNP"
            and tok.pos in ("NNG", "NNP")
            and prev.char_end == tok.char_start  # no space between them
        )
        if joinable:
            prev.surface += tok.surface
            prev.lemma = prev.surface
            prev.char_end = tok.char_end
            continue
        merged.append(tok)
    return merged


class KoreanTokeniser:
    """kiwipiepy. Gives stems directly, so lemmatising is mostly adding 다."""

    def __init__(self):
        from kiwipiepy import Kiwi
        self.kiwi = Kiwi()

    def __call__(self, text: str) -> List[Token]:
        tokens = []
        for t in self.kiwi.tokenize(text):
            lemma = t.form
            # Kiwi strips the ending off predicates and hands back the stem.
            # 먹었어요 -> 먹/VV, so the dictionary form needs 다 back on it.
            if t.tag in KIWI_VERBAL_TAGS and not lemma.endswith("다"):
                lemma = lemma + "다"
            tokens.append(Token(
                surface=t.form,
                lemma=lemma,
                pos=t.tag,
                char_start=t.start,
                char_end=t.start + t.len,
                content=t.tag in KIWI_CONTENT_TAGS,
            ))
        return merge_proper_nouns(tokens)


class ChineseTokeniser:
    """jieba. Segmentation only — Chinese words do not inflect, so lemma == surface."""

    def __init__(self):
        import jieba.posseg as posseg
        self.posseg = posseg

    def __call__(self, text: str) -> List[Token]:
        tokens = []
        cursor = 0
        for word, flag in self.posseg.cut(text):
            # jieba does not report offsets in this mode, so walk the string.
            idx = text.find(word, cursor)
            if idx == -1:
                idx = cursor
            cursor = idx + len(word)
            tokens.append(Token(
                surface=word,
                lemma=word,
                pos=flag,
                char_start=idx,
                char_end=idx + len(word),
                content=flag in JIEBA_CONTENT_TAGS and not word.isspace(),
            ))
        return tokens


class TurkishTokeniser:
    """zeyrek, a Python port of Zemberek.

    Turkish is agglutinative like Korean, so the same problem applies: without
    lemmatising, arkadaşlarımla ("with my friends") would be saved as its own
    vocabulary item instead of arkadaş ("friend").

    Words are split on whitespace and punctuation rather than by a
    morphological segmenter, because zeyrek analyses whole words and the
    character offsets have to line up with the original text for word timings.
    """

    # Zeyrek's coarse tags. Nouns, verbs, adjectives and adverbs are the
    # flashcard-worthy ones; pronouns, conjunctions and postpositions are not.
    CONTENT_POS = {"Noun", "Verb", "Adj", "Adv"}

    def __init__(self):
        import logging
        import zeyrek

        # zeyrek logs every candidate parse it considers — at WARNING level, so
        # setting INFO is not enough. Without this the worker output is
        # unreadable and a real warning would be lost in it.
        logging.getLogger("zeyrek.rulebasedanalyzer").setLevel(logging.ERROR)
        logging.getLogger("zeyrek").setLevel(logging.ERROR)

        self.analyzer = zeyrek.MorphAnalyzer()
        self._freq = None

    def _frequency(self, word: str) -> float:
        """How common a lemma is, for choosing between parses."""
        if self._freq is None:
            from wordfreq import get_frequency_dict
            self._freq = get_frequency_dict("tr")
        return self._freq.get(word.lower(), 0.0)

    def _analyse(self, word: str):
        """Return (lemma, pos). Falls back to the surface form when unknown.

        Turkish morphology is ambiguous and zeyrek returns every reading it can
        construct. çözümü parses both as çöz + üm ("my çöz") and as çözüm + ü
        ("the solution"), and taking the first reading gave çöz — which is not a
        word a learner would ever want on a card.

        Picking the most frequent lemma resolves it: çözüm is common, çöz as a
        bare noun is not. This is a heuristic, and it will pick wrongly when a
        rare word genuinely was meant, but it is right far more often than
        trusting parse order.
        """
        try:
            parses = self.analyzer.analyze(word)
        except Exception:
            return word, ""
        flat = [p for group in parses for p in group] if parses else []
        if not flat:
            return word, ""

        best = max(
            flat,
            key=lambda p: (self._frequency(p.lemma or ""), len(p.lemma or "")),
        )
        return best.lemma or word, best.pos or ""

    def __call__(self, text: str) -> List[Token]:
        import re

        tokens = []
        # Keep punctuation as its own token so offsets cover the whole string.
        for m in re.finditer(r"\w+|[^\w\s]", text, re.UNICODE):
            surface = m.group()
            if surface.isalnum() or "'" in surface:
                lemma, pos = self._analyse(surface)
            else:
                lemma, pos = surface, "Punc"
            tokens.append(Token(
                surface=surface,
                lemma=lemma,
                pos=pos,
                char_start=m.start(),
                char_end=m.end(),
                content=pos in self.CONTENT_POS and len(surface) > 1,
            ))
        return tokens


def get_tokeniser(language: str):
    if language == "ko":
        return KoreanTokeniser()
    if language == "zh":
        return ChineseTokeniser()
    if language == "tr":
        return TurkishTokeniser()
    raise ValueError(
        f"no tokeniser for language {language!r} (expected 'ko', 'zh' or 'tr')"
    )
