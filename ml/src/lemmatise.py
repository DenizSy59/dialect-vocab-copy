"""Tokenising and lemmatising for Chinese and Korean.

Chinese has no inflection, so the lemma is the surface form and the only real
work is word segmentation. Korean is agglutinative, so 먹었어요 has to come back
as 먹다 or a saved vocabulary card is useless.

Both tokenisers report character offsets into the segment text. transcribe.py
uses those offsets to attach word-level timings, so they must be accurate.
"""

from dataclasses import dataclass, asdict
from typing import List, Optional


# What counts as vocabulary.
#
# The test is whether a learner would put it on a flashcard. Particles and
# endings fail it — nobody studies 을/를 or 了 as a word.
#
# Pronouns, determiners, numerals and classifiers pass it, and leaving them out
# was a real bug: 저 ("I"), 이것 ("this"), 그 ("that"), 我们 ("we"), 他 ("he") and
# 一起 ("together") were all unclickable — among the first words anyone learns.
#
# Erring wide is the right direction. An extra clickable word costs a glance; a
# missing one means the learner cannot save a word they need and has no way to
# tell why it is not offered.
#
# SL (foreign script) stays excluded. Latin-script tokens like "FC" and "AI"
# were being offered as Korean vocabulary, which is noise — a learner already
# reads them. Loanwords written in hangul are tagged NNG and still count.

KIWI_CONTENT_TAGS = {
    "NNG", "NNP", "NNB", "NR",   # nouns and numerals
    "NP",                        # pronouns — 저, 이것, 우리
    "MM",                        # determiners — 그, 이, 어떤
    "VV", "VA", "VX",            # verbs and adjectives
    "MAG", "MAJ",                # adverbs
    "XR",                        # roots
}
JIEBA_CONTENT_TAGS = {
    "n", "nr", "ns", "nt", "nz",  # nouns
    "v", "vd", "vn",              # verbs
    "a", "ad", "an",              # adjectives
    "d",                          # adverbs
    "r",                          # pronouns — 我们, 他, 她, 这
    "m",                          # numerals, and where jieba files 一起
    "q",                          # classifiers, which Chinese courses teach
    "i", "l", "s", "t",           # idioms, phrases, place and time words
}

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

    # Same test as the other languages: would it go on a flashcard? Pronouns
    # and numerals would; conjunctions and postpositions would not.
    CONTENT_POS = {"Noun", "Verb", "Adj", "Adv", "Pron", "Num"}

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


class EnglishTokeniser:
    """English, for learners whose target language is English.

    No morphological analyser here. English inflection is shallow enough that
    suffix stripping plus a frequency check does most of the job: strip a
    candidate ending, and accept the result only if it is a word the corpus
    actually knows. That rejects "hi" from "his" while accepting "run" from
    "running".

    It is a heuristic and it will miss irregulars — "went" stays "went" rather
    than becoming "go". Fixing that properly needs a lemma dictionary, which is
    worth doing if English becomes a main target rather than a convenience.
    """

    # Closed-class words. A learner does not save "the" or "of", and leaving
    # them clickable buries the words that matter.
    FUNCTION_WORDS = {
        "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on",
        "at", "by", "for", "with", "from", "as", "is", "are", "was", "were",
        "be", "been", "being", "am", "do", "does", "did", "have", "has", "had",
        "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us",
        "them", "my", "your", "his", "its", "our", "their", "this", "that",
        "these", "those", "not", "no", "so", "than", "then", "there", "here",
        "what", "which", "who", "whom", "when", "where", "why", "how", "all",
        "any", "some", "just", "very", "too", "can", "will", "would", "could",
        "should", "may", "might", "must", "shall", "up", "out", "about", "into",
        "over", "after", "before", "s", "t", "re", "ve", "ll", "d", "m",
    }

    SUFFIXES = [
        ("ies", "y"), ("ied", "y"), ("ying", "ie"),
        ("sses", "ss"), ("shes", "sh"), ("ches", "ch"), ("xes", "x"),
        ("ing", ""), ("ed", ""), ("es", ""), ("s", ""),
        ("ly", ""), ("er", ""), ("est", ""),
    ]

    def __init__(self):
        self._freq = None

    def _frequency(self, word: str) -> float:
        if self._freq is None:
            from wordfreq import get_frequency_dict
            self._freq = get_frequency_dict("en")
        return self._freq.get(word, 0.0)

    def _lemma(self, word: str) -> str:
        """Most frequent plausible stem, not the first one that exists.

        Accepting the first known stem was wrong: the frequency list contains
        junk like "runn" and "stor", so running became runn and stores became
        stor. Every candidate is generated and the commonest one wins, which
        picks run over runn and store over stor.
        """
        w = word.lower()
        candidates = {w: self._frequency(w)}

        for suffix, replacement in self.SUFFIXES:
            if not w.endswith(suffix) or len(w) - len(suffix) < 2:
                continue
            stem = w[: -len(suffix)] + replacement
            candidates[stem] = self._frequency(stem)
            # running -> runn -> run
            if len(stem) > 2 and stem[-1] == stem[-2]:
                candidates[stem[:-1]] = self._frequency(stem[:-1])
            # stor -> store, hop -> hope
            candidates[stem + "e"] = self._frequency(stem + "e")

        best = max(candidates, key=lambda c: candidates[c])
        # If nothing scored, the word is unknown — keep it as it was rather
        # than inventing a stem.
        return best if candidates[best] > 0 else w

    def __call__(self, text: str) -> List[Token]:
        import re

        tokens = []
        for m in re.finditer(r"[A-Za-z]+(?:'[A-Za-z]+)?|[^\sA-Za-z]", text):
            surface = m.group()
            is_word = surface[0].isalpha()
            lemma = self._lemma(surface) if is_word else surface
            tokens.append(Token(
                surface=surface,
                lemma=lemma,
                pos="WORD" if is_word else "PUNCT",
                char_start=m.start(),
                char_end=m.end(),
                content=(
                    is_word
                    and len(surface) > 1
                    and lemma not in self.FUNCTION_WORDS
                ),
            ))
        return tokens


def get_tokeniser(language: str):
    if language == "ko":
        return KoreanTokeniser()
    if language == "zh":
        return ChineseTokeniser()
    if language == "tr":
        return TurkishTokeniser()
    if language == "en":
        return EnglishTokeniser()
    raise ValueError(
        f"no tokeniser for language {language!r} (expected 'ko', 'zh', 'tr' or 'en')"
    )
