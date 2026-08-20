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

    def test_latin_script_is_not_offered_as_vocabulary(self, ko):
        # "FC" was showing up as a clickable Korean word. A learner already
        # reads it, and it has no dictionary entry.
        for t in ko("FC 서울에 왔습니다"):
            if t.surface == "FC":
                assert t.content is False

    def test_hangul_loanwords_still_count(self, ko):
        # Excluding foreign script must not exclude loanwords written in hangul.
        tokens = {t.surface: t for t in ko("커피를 마셔요")}
        assert tokens["커피"].content is True


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


class TestTurkish:
    """Turkish is agglutinative like Korean, so lemmatising matters as much."""

    @pytest.fixture(scope="class")
    def tr(self):
        return get_tokeniser("tr")

    def test_verb_to_infinitive(self, tr):
        assert "izlemek" in lemmas(tr("Dün bir film izledim"))

    def test_possessive_and_case_stripped(self, tr):
        assert "arkadaş" in lemmas(tr("arkadaşlarımla konuştum"))

    def test_offsets_reconstruct_the_text(self, tr):
        text = "Dün güzel bir film izledim"
        for t in tr(text):
            assert text[t.char_start:t.char_end] == t.surface

    def test_punctuation_is_not_content(self, tr):
        for t in tr("Merhaba, nasılsın?"):
            if t.surface in (",", "?"):
                assert t.content is False


class TestTurkishAmbiguity:
    """zeyrek returns every reading; the most frequent lemma should win."""

    @pytest.fixture(scope="class")
    def tr(self):
        return get_tokeniser("tr")

    def test_cozumu_is_cozum_not_coz(self, tr):
        # Parses as both çöz+üm ("my çöz") and çözüm+ü ("the solution").
        # Parse order gave çöz, which is not a word worth saving.
        assert "çözüm" in lemmas(tr("Teknoloji çözümü getirir"))
        assert "çöz" not in lemmas(tr("Teknoloji çözümü getirir"))


class TestIrregularVerbs:
    """Kiwi tags irregular predicates VV-I, not VV.

    Matching the plain tags missed the whole ㅂ/ㄷ/ㅅ-irregular class, so 돕다,
    듣다 and 짓다 were unclickable and never got a dictionary form — while
    regular verbs worked, which is what kept it hidden.
    """

    def test_p_irregular(self, ko):
        assert "돕다" in lemmas(ko("도왔던 사람"))

    def test_d_irregular(self, ko):
        assert "듣다" in lemmas(ko("음악을 들었어요"))

    def test_s_irregular(self, ko):
        assert "짓다" in lemmas(ko("집을 지었다"))

    def test_irregulars_are_clickable(self, ko):
        assert any(t.content for t in ko("도왔던 사람") if t.lemma == "돕다")


class TestPredicateMerging:
    """A verb and its endings are one word on screen."""

    def test_endings_join_the_stem(self, ko):
        surfaces = [t.surface for t in ko("밥을 먹었어요")]
        assert "먹었어요" in surfaces
        assert "먹" not in surfaces, "the bare stem should not appear on its own"

    def test_contraction_uses_the_text_not_the_morphemes(self, ko):
        # 도왔던 is 돕 + 았 + 던. Joining morphemes would give 돕았던, which is not
        # what is on screen and would break the offsets word timings rely on.
        surfaces = [t.surface for t in ko("도왔던 사람")]
        assert "도왔던" in surfaces
        assert "돕았던" not in surfaces

    def test_particles_are_left_alone(self, ko):
        # An ending belongs to the verb; 을 is a separate word and gluing it on
        # would bury 밥 inside a token that is not a vocabulary item.
        surfaces = [t.surface for t in ko("밥을 먹었어요")]
        assert "밥" in surfaces
        assert "밥을" not in surfaces

    def test_offsets_still_map_onto_the_text(self, ko):
        text = "도왔던 사람이 밥을 먹었어요"
        for t in ko(text):
            assert text[t.char_start:t.char_end] == t.surface


class TestClickableWordClasses:
    """Pronouns, determiners and numerals are vocabulary too."""

    def test_korean_pronouns(self, ko):
        clickable = [t.surface for t in ko("저는 이것을 봤다") if t.content]
        assert "저" in clickable
        assert "이것" in clickable

    def test_chinese_pronouns_and_adverbs(self, zh):
        clickable = [t.surface for t in zh("我们一起去") if t.content]
        assert "我们" in clickable
        assert "一起" in clickable
