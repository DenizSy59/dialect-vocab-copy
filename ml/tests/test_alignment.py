"""Mapping aligned words onto tokens.

This is the part that decides whether a clip cuts at the right moment, so the
awkward cases get explicit tests: Chinese arriving per character, Korean per
spacing unit, and tokens that overlap the same character.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from pipeline import word_spans, attach_timings
from lemmatise import Token


def test_word_spans_locates_words_in_order():
    text = "안녕하세요 반갑습니다"
    words = [
        {"word": "안녕하세요", "start": 0.0, "end": 0.8},
        {"word": "반갑습니다", "start": 0.9, "end": 1.7},
    ]
    spans = word_spans(text, words)
    assert spans == [(0, 5, 0.0, 0.8), (6, 11, 0.9, 1.7)]


def test_repeated_word_does_not_collapse_onto_the_first_occurrence():
    # Searching from the start every time would give both entries the same span
    # and the second one would get the first one's timing.
    text = "네 네"
    words = [
        {"word": "네", "start": 0.0, "end": 0.2},
        {"word": "네", "start": 0.5, "end": 0.7},
    ]
    spans = word_spans(text, words)
    assert spans[0][0] == 0
    assert spans[1][0] == 2


def test_chinese_per_character_words_cover_a_multi_character_token():
    text = "吃饭了"
    words = [
        {"word": "吃", "start": 1.0, "end": 1.2},
        {"word": "饭", "start": 1.2, "end": 1.4},
        {"word": "了", "start": 1.4, "end": 1.5},
    ]
    spans = word_spans(text, words)
    token = Token("吃饭", "吃饭", "v", 0, 2, True)
    attach_timings([token], spans)
    # Spans the first two characters, so it must take the union of their times.
    assert token.start == 1.0
    assert token.end == 1.4


def test_overlapping_tokens_both_receive_timings():
    # 왔 is 오/VV + 았/EP, both pointing at the same character.
    text = "왔다"
    spans = word_spans(text, [{"word": "왔다", "start": 2.0, "end": 2.6}])
    a = Token("오", "오다", "VV", 0, 1, True)
    b = Token("았", "았", "EP", 0, 1, False)
    attach_timings([a, b], spans)
    assert a.start == 2.0 and b.start == 2.0


def test_token_with_no_overlapping_word_keeps_none():
    spans = word_spans("가나", [{"word": "가나", "start": 0.1, "end": 0.4}])
    orphan = Token("다", "다", "EF", 5, 6, False)
    attach_timings([orphan], spans)
    assert orphan.start is None


def test_words_without_timings_are_ignored():
    # The aligner can return a word with null times; treating that as 0.0 would
    # make a clip start at the beginning of the video.
    text = "가나"
    spans = word_spans(text, [{"word": "가나", "start": None, "end": None}])
    token = Token("가나", "가나", "NNP", 0, 2, True)
    attach_timings([token], spans)
    assert token.start is None


def test_word_not_present_in_text_is_skipped():
    spans = word_spans("안녕", [{"word": "없음", "start": 0.0, "end": 1.0}])
    assert spans == []
