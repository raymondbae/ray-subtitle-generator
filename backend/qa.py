"""생성된 자막에서 Whisper 할루시네이션 의심 구간을 자동으로 찾아낸다."""
from __future__ import annotations

import re
from collections import Counter

from srt_utils import Segment

_HANGUL_RE = re.compile(r"[가-힣]")
_UNEXPECTED_SCRIPT_RE = re.compile(
    r"[؀-ۿЀ-ӿऀ-ॿ一-鿿฀-๿]"
)  # 아랍/키릴/데바나가리/한자/태국 문자 등 - 이 영상엔 나올 일이 없는 문자들


def find_flag(segments: list[Segment], index: int) -> str | None:
    """세그먼트 하나가 의심스러운지 판단하고, 그렇다면 이유를 반환한다."""
    text = segments[index].text.strip()
    if not text:
        return None

    if "�" in text:
        return "깨진 문자 포함 (인코딩/인식 오류 의심)"

    if _UNEXPECTED_SCRIPT_RE.search(text):
        return "한국어 영상에 어색한 문자 포함 (언어 인식 오류 의심)"

    has_hangul = bool(_HANGUL_RE.search(text))
    is_short_acronym = text.isupper() and len(text.replace(" ", "")) <= 6
    if not has_hangul and any(c.isalpha() for c in text) and not is_short_acronym:
        # 한글이 전혀 없이 영어 단어/문장만 있는 경우 (DJI, KT 같은 짧은 대문자 약어는 정상적인 브랜드명이라 제외)
        return "한글 없이 영어로만 인식됨 (언어 혼동 의심)"

    if index > 0 and segments[index - 1].text.strip() == text:
        return "이전 문장과 동일 (반복 의심)"

    words = text.split()
    if len(words) >= 6:
        most_common, count = Counter(words).most_common(1)[0]
        if count >= 6 and count / len(words) > 0.5:
            return "한 문장 안에서 단어 반복 (할루시네이션 의심)"

        # 단어 하나가 아니라 짧은 구절(2~4단어)이 계속 순환 반복되는 경우
        # (예: "한 지방에 있는 한 지방에 있는 ...") - 고유 단어 비율이 극히 낮음
        unique_ratio = len(set(words)) / len(words)
        if len(words) >= 15 and unique_ratio < 0.2:
            return "짧은 구절이 계속 순환 반복 (할루시네이션 의심, 내용 신뢰 불가)"

    # 서로 다른 문장 2~3개가 세그먼트 여러 개에 걸쳐 번갈아 반복되는 경우
    # (예: "A" "B" "A" "B" "A" ...) - 완전히 동일한 문장의 즉시 반복은 아니라서 위 규칙들이 못 잡는다.
    for period in (2, 3):
        needed = period * 2
        if index - needed + 1 < 0:
            continue
        cycle = [segments[index - k].text.strip() for k in range(period)]
        if len(set(cycle)) <= 1:
            continue  # 이미 위에서 처리되는 단순 반복
        matches = all(
            segments[index - k].text.strip() == segments[index - k - period].text.strip()
            for k in range(period)
        )
        if matches:
            return f"{period}개 문장이 번갈아 순환 반복 (할루시네이션 의심)"

    return None


def annotate(segments: list[Segment]) -> list[dict]:
    """세그먼트 목록을 dict로 변환하면서 의심 구간에 flag를 붙인다."""
    result = []
    for i, seg in enumerate(segments):
        d = dict(seg.__dict__)
        d["flag"] = find_flag(segments, i)
        result.append(d)
    return result
