"""Difficulty scoring and the evaluation harness.

The evaluation numbers go in the report, so the alignment and attribution code
behind them needs to be right. A silent off-by-one in the aligner would shift
every error rate without anything looking wrong.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from difficulty import score_segment, frequency_table, clamp01
from evaluate import align, cer, normalise


@pytest.fixture(scope="module")
def ko_table():
    return frequency_table("ko")


class TestAlign:
    def test_identical_sequences_are_all_equal(self):
        ops = align(list("abc"), list("abc"))
        assert [o[0] for o in ops] == ["equal"] * 3

    def test_substitution(self):
        ops = align(list("abc"), list("axc"))
        assert [o[0] for o in ops] == ["equal", "sub", "equal"]

    def test_deletion(self):
        assert "del" in [o[0] for o in align(list("abc"), list("ac"))]

    def test_insertion(self):
        assert "ins" in [o[0] for o in align(list("ac"), list("abc"))]

    def test_reference_index_present_for_every_non_insertion(self):
        # Error attribution needs the reference index; without it a
        # substitution cannot be classed as content or function.
        for op, ri, _ in align(list("abc"), list("axd")):
            if op != "ins":
                assert ri is not None

    def test_empty_hypothesis_is_all_deletions(self):
        assert [o[0] for o in align(list("abc"), [])] == ["del"] * 3


class TestCer:
    def test_perfect_match_is_zero(self):
        errors, length = cer("안녕하세요", "안녕하세요")
        assert errors == 0 and length == 5

    def test_one_wrong_character(self):
        errors, _ = cer("안녕하세요", "안녕하세오")
        assert errors == 1

    def test_returns_reference_length_for_pooling(self):
        # Rates are pooled across clips, so the denominator must be the
        # reference length and not the hypothesis length.
        _, length = cer("abcde", "ab")
        assert length == 5


class TestNormalise:
    def test_punctuation_is_stripped(self):
        assert normalise("안녕, 하세요!") == normalise("안녕하세요")

    def test_whitespace_is_stripped(self):
        assert normalise("你 好") == "你好"

    def test_numbers_are_left_alone(self):
        # Documented as unnormalised, which makes the rates pessimistic. If this
        # ever starts passing, the reported error rates changed meaning.
        assert normalise("200만") != normalise("이백만")


class TestDifficulty:
    def test_returns_none_without_duration(self, ko_table):
        assert score_segment("안녕", [], 1.0, 1.0, ko_table) is None

    def test_rare_words_score_higher_than_common_ones(self, ko_table):
        common = score_segment(
            "사람 물", [{"lemma": "사람", "content": True}, {"lemma": "물", "content": True}],
            0.0, 3.0, ko_table,
        )
        rare = score_segment(
            "수비수 헌신", [{"lemma": "수비수", "content": True}, {"lemma": "헌신", "content": True}],
            0.0, 3.0, ko_table,
        )
        assert rare > common

    def test_faster_speech_scores_higher(self, ko_table):
        tokens = [{"lemma": "사람", "content": True}]
        slow = score_segment("사람" * 10, tokens, 0.0, 10.0, ko_table)
        fast = score_segment("사람" * 10, tokens, 0.0, 2.0, ko_table)
        assert fast > slow

    def test_score_stays_in_range(self, ko_table):
        tokens = [{"lemma": "쟯쫇", "content": True}] * 5
        s = score_segment("쟯쫇" * 40, tokens, 0.0, 0.5, ko_table)
        assert 0.0 <= s <= 1.0

    def test_unknown_word_counts_as_hard(self, ko_table):
        # Missing from a large corpus means rare, which is the right default —
        # that is exactly the rare-term case.
        known = score_segment("사람", [{"lemma": "사람", "content": True}], 0.0, 2.0, ko_table)
        unknown = score_segment("쟯쫇", [{"lemma": "쟯쫇", "content": True}], 0.0, 2.0, ko_table)
        assert unknown > known


def test_clamp01():
    assert clamp01(-5) == 0.0
    assert clamp01(5) == 1.0
    assert clamp01(0.5) == 0.5


class TestSpaceDelimitedNormalisation:
    """Turkish exposed this: stripping spaces destroyed its word boundaries."""

    def test_turkish_keeps_word_boundaries(self):
        assert normalise("Teknoloji, çözümü sanal bir tur.", "tr") == (
            "teknoloji çözümü sanal bir tur"
        )

    def test_korean_still_drops_spaces(self):
        # Whisper's Korean spacing differs from the reference constantly and
        # counting it as an error would inflate every rate.
        assert normalise("안녕하세요. 반갑습니다", "ko") == "안녕하세요반갑습니다"

    def test_turkish_punctuation_becomes_a_boundary(self):
        # "bir,tur" must not fuse into one token when the comma is removed.
        assert normalise("bir,tur", "tr") == "bir tur"
