"""사용자가 지정한 찾기/바꾸기 규칙을 저장해두고, 새 자막 생성 시 자동으로 적용한다."""
from __future__ import annotations

import json
from pathlib import Path

from srt_utils import Segment

CORRECTIONS_PATH = Path(__file__).resolve().parent.parent / "data" / "corrections.json"


def load_corrections() -> list[dict]:
    if not CORRECTIONS_PATH.is_file():
        return []
    return json.loads(CORRECTIONS_PATH.read_text(encoding="utf-8"))


def save_corrections(rules: list[dict]) -> None:
    CORRECTIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CORRECTIONS_PATH.write_text(json.dumps(rules, ensure_ascii=False, indent=2), encoding="utf-8")


def add_correction(find: str, replace: str) -> list[dict]:
    """이미 같은 find 규칙이 있으면 replace 값만 갱신하고, 없으면 새로 추가한다."""
    rules = load_corrections()
    for r in rules:
        if r["find"] == find:
            r["replace"] = replace
            save_corrections(rules)
            return rules
    rules.append({"find": find, "replace": replace})
    save_corrections(rules)
    return rules


def remove_correction(find: str) -> list[dict]:
    rules = [r for r in load_corrections() if r["find"] != find]
    save_corrections(rules)
    return rules


def apply_corrections(segments: list[Segment]) -> int:
    """저장된 규칙을 세그먼트 목록에 일괄 적용하고, 실제로 바뀐 총 횟수를 반환한다."""
    rules = load_corrections()
    if not rules:
        return 0
    total = 0
    for seg in segments:
        for rule in rules:
            find, replace = rule.get("find", ""), rule.get("replace", "")
            if find and find in seg.text:
                total += seg.text.count(find)
                seg.text = seg.text.replace(find, replace)
    return total
