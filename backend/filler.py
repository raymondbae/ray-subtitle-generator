"""'지나갑니다' 류의 의미 없는 필러성 한 줄 자막을 자동으로 걸러낸다."""
from __future__ import annotations

import json
import re
from pathlib import Path

from srt_utils import Segment

FILLER_PATH = Path(__file__).resolve().parent.parent / "data" / "filler_phrases.json"

_DEFAULT_PHRASES = [
    "지나갑니다",
    "지나갈게요",
    "지나갈께요",
    "지나가겠습니다",
]


def load_phrases() -> list[str]:
    if not FILLER_PATH.is_file():
        save_phrases(_DEFAULT_PHRASES)
        return list(_DEFAULT_PHRASES)
    return json.loads(FILLER_PATH.read_text(encoding="utf-8"))


def save_phrases(phrases: list[str]) -> None:
    FILLER_PATH.parent.mkdir(parents=True, exist_ok=True)
    FILLER_PATH.write_text(json.dumps(phrases, ensure_ascii=False, indent=2), encoding="utf-8")


def add_phrase(phrase: str) -> list[str]:
    phrases = load_phrases()
    if phrase not in phrases:
        phrases.append(phrase)
        save_phrases(phrases)
    return phrases


def remove_phrase(phrase: str) -> list[str]:
    phrases = [p for p in load_phrases() if p != phrase]
    save_phrases(phrases)
    return phrases


def _normalize(text: str) -> str:
    """구두점/공백을 제거해 비교하기 쉽게 만든다."""
    return re.sub(r"[^\w가-힣]", "", text).strip()


def filter_filler_segments(segments: list[Segment]) -> list[Segment]:
    """한 줄 전체가 필러 문구와 (구두점 무시하고) 완전히 같은 경우만 제거한다.
    문장의 일부로 포함된 경우(예: "저기 지나갑니다 조심하세요")는 건드리지 않는다."""
    phrases = {_normalize(p) for p in load_phrases()}
    if not phrases:
        return segments
    kept = [seg for seg in segments if _normalize(seg.text) not in phrases]
    for i, seg in enumerate(kept, start=1):
        seg.index = i
    return kept
