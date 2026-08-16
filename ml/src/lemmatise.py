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
KIWI_CONTENT_TAGS = {"NNG", "NNP", "NNB", "NR", "VV", "VA", "VX", "MAG", "MAJ", "XR", "SL"}
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
        return tokens


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


def get_tokeniser(language: str):
    if language == "ko":
        return KoreanTokeniser()
    if language == "zh":
        return ChineseTokeniser()
    raise ValueError(f"no tokeniser for language {language!r} (expected 'ko' or 'zh')")
