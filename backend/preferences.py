"""자막 굽기 스타일 등, 마지막으로 쓴 UI 설정을 저장해두고 다음에도 그대로 불러온다."""
from __future__ import annotations

import json
from pathlib import Path

PREFS_PATH = Path(__file__).resolve().parent.parent / "data" / "preferences.json"

DEFAULT_BURN_STYLE = {
    "font_size": 32,
    "primary_colour": "&H00FFFFFF",
    "outline_colour": "&H00000000",
    "alignment": 2,
    "margin_v": 70,
}


def load_burn_style() -> dict:
    if not PREFS_PATH.is_file():
        return DEFAULT_BURN_STYLE
    data = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
    return data.get("burn_style", DEFAULT_BURN_STYLE)


def save_burn_style(style: dict) -> None:
    PREFS_PATH.parent.mkdir(parents=True, exist_ok=True)
    data = {}
    if PREFS_PATH.is_file():
        data = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
    data["burn_style"] = style
    PREFS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
