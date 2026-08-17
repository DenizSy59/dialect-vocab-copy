"""Tokenising and lemmatising.

These lock in behaviour that was wrong at some point during development, so a
regression here means something real broke rather than a style change.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from lemmatise import get_tokeniser, merge_proper_nouns, Token


@pytest.fixture(scope="module")
def ko():
    return get_tokeniser("ko")


@pytest.fixture(scope="module")
def zh():
    return get_tokeniser("zh")


def lemmas(tokens):
    return [t.lemma for t in tokens]


class TestKoreanLemmas:
    def test_the_example_from_the_brief(self, ko):
        # 먹었어요 must become 먹다 or saved words are useless.
        assert "먹다" in lemmas(ko("어제 밥을 먹었어요"))

    def test_contraction(self, ko):
        # 왔 is 오 + 았 fused into one syllable.
        assert "오다" in lemmas(ko("서울에서 왔는데"))

    def test_irregular_adjective(self, ko):
        assert "예쁘다" in lemmas(ko("진짜 예뻤어요"))

    def test_particles_are_not_content(self, ko):
        tokens = {t.surface: t for t in ko("밥을 먹었어요")}
        assert tokens["을"].content is False
        assert tokens["밥"].content is True


class TestProperNounMerging:
    """The bug that saved 손호준 as 손호."""

    def test_splits_are_rejoined(self, ko):
        assert "손호준" in lemmas(ko("손호준입니다"))

    def test_names_kiwi_already_knows_are_untouched(self, ko):
        out = lemmas(ko("박지성과 김연아를 만났다"))
        assert "박지성" in out
        assert "김연아" in out

    def test_space_prevents_merging(self, ko):
        # 한국 사람 is two words, not the name 한국사람.
        out = lemmas(ko("한국 사람이에요"))
        assert "한국" in out
        assert "한국사람" not in out

    def test_particle_after_name_is_not_absorbed(self):
        toks = [
            Token("박지성", "박지성", "NNP", 0, 3, True),
            Token("과", "과", "JC", 3, 4, False),
        ]
        assert [t.surface for t in merge_proper_nouns(toks)] == ["박지성", "과"]


class TestOffsets:
    """Character offsets drive both timing attachment and rendering."""

    def test_offsets_stay_inside_the_text(self, ko):
        text = "어제 친구랑 밥을 먹었어요"
        for t in ko(text):
            assert 0 <= t.char_start < t.char_end <= len(text)

    def test_chinese_offsets_reconstruct_the_text(self, zh):
        text = "我昨天跟朋友一起吃饭了"
        rebuilt = "".join(text[t.char_start:t.char_end] for t in zh(text))
        assert rebuilt == text


class TestChinese:
    def test_segmentation(self, zh):
        assert "朋友" in lemmas(zh("我昨天跟朋友一起吃饭了"))

    def test_lemma_equals_surface(self, zh):
        # Chinese does not inflect, so these must never diverge.
        for t in zh("我昨天跟朋友一起吃饭了"):
            assert t.lemma == t.surface


def test_unknown_language_is_rejected():
    with pytest.raises(ValueError):
        get_tokeniser("ja")
