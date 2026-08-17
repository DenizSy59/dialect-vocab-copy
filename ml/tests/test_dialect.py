"""Dialect detection.

Both directions matter equally. A detector that fires on everything is as
useless as one that never fires, and the first version of this did the former —
it counted the character 노 and flagged every transcript containing 노력.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from dialect import detect, annotate_segments, _eojeol_match
from lemmatise import get_tokeniser


@pytest.fixture(scope="module")
def ko():
    return get_tokeniser("ko")


def segs(tokeniser, lines):
    return [{"text": l, "tokens": [t.to_dict() for t in tokeniser(l)]} for l in lines]


class TestPositives:
    def test_gyeongsang(self, ko):
        r = detect(segs(ko, ["억수로 단디 해라", "뭐꼬 이게", "머스마가 크다"]), "ko")
        assert r["detected"] and r["dialect"] == "gyeongsang"

    def test_jeolla(self, ko):
        r = detect(segs(ko, ["거시기 좀 갖고 오랑께", "아따 시방 뭣이", "오메 워메"]), "ko")
        assert r["detected"] and r["dialect"] == "jeolla"

    def test_jeju(self, ko):
        r = detect(segs(ko, ["혼저 옵서예", "하영 먹읍서", "감수광"]), "ko")
        assert r["detected"] and r["dialect"] == "jeju"

    def test_evidence_is_returned(self, ko):
        r = detect(segs(ko, ["억수로 단디 해라", "뭐꼬 이게"]), "ko")
        assert r["evidence"], "a detection with no evidence cannot be checked"


class TestNegatives:
    def test_standard_korean_does_not_fire(self, ko):
        r = detect(
            segs(ko, ["안녕하세요 반갑습니다", "오늘 날씨가 좋네요", "정말 고맙습니다"]), "ko"
        )
        assert not r["detected"]

    def test_noryeok_does_not_look_like_gyeongsang(self, ko):
        # The original substring bug: 노력 contains 노, a Gyeongsang ending.
        r = detect(segs(ko, ["더 노력하겠습니다", "노력이 중요합니다"]), "ko")
        assert r["all_scores"]["gyeongsang"] == 0.0

    def test_gomawoyo_does_not_match_goma(self, ko):
        # 고마 is a Gyeongsang marker; 고마워요 is ordinary standard Korean.
        r = detect(segs(ko, ["정말 고마워요", "고마워요 진짜"]), "ko")
        assert r["all_scores"]["gyeongsang"] == 0.0


class TestEojeolMatching:
    def test_exact_match(self):
        assert _eojeol_match("단디", "단디")

    def test_long_marker_allows_a_suffix(self):
        assert _eojeol_match("억수로도", "억수로")

    def test_short_marker_requires_exact(self):
        # Guard for the 고마 / 고마워요 case.
        assert not _eojeol_match("고마워요", "고마")


class TestEdgeCases:
    def test_empty_input(self):
        assert detect([], "ko")["available"] is False

    def test_unknown_language_reports_unavailable(self, ko):
        r = detect(segs(ko, ["안녕하세요"]), "xx")
        assert r["available"] is False

    def test_result_always_carries_its_caveat(self, ko):
        # The number invites more confidence than it earns, so the limitation
        # travels with it rather than living only in the docs.
        r = detect(segs(ko, ["억수로 단디"]), "ko")
        assert "not a trained classifier" in r["caveat"]


def test_segment_annotation_marks_only_the_dialect_line(ko):
    lines = ["안녕하세요 반갑습니다", "억수로 단디 해라"]
    s = segs(ko, lines)
    annotate_segments(s, "ko")
    assert s[0]["dialectMarkers"] == []
    assert s[1]["dialectMarkers"]
