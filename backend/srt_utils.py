"""SRT 자막 파싱/직렬화 유틸리티."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Segment:
    index: int
    start: float  # 초 단위
    end: float
    text: str


def _format_timestamp(seconds: float) -> str:
    """초를 SRT 타임스탬프(HH:MM:SS,mmm) 형식으로 변환."""
    if seconds < 0:
        seconds = 0
    total_ms = round(seconds * 1000)
    hours, rem_ms = divmod(total_ms, 3_600_000)
    minutes, rem_ms = divmod(rem_ms, 60_000)
    secs, ms = divmod(rem_ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def _parse_timestamp(ts: str) -> float:
    hms, ms = ts.strip().split(",")
    hours, minutes, secs = hms.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + int(secs) + int(ms) / 1000


def segments_to_srt(segments: list[Segment]) -> str:
    """세그먼트 목록을 SRT 텍스트로 직렬화."""
    blocks = []
    for i, seg in enumerate(segments, start=1):
        block = (
            f"{i}\n"
            f"{_format_timestamp(seg.start)} --> {_format_timestamp(seg.end)}\n"
            f"{seg.text.strip()}\n"
        )
        blocks.append(block)
    return "\n".join(blocks)


def srt_to_segments(srt_text: str) -> list[Segment]:
    """SRT 텍스트를 세그먼트 목록으로 파싱."""
    segments: list[Segment] = []
    blocks = [b.strip() for b in srt_text.strip().split("\n\n") if b.strip()]
    for block in blocks:
        lines = block.split("\n")
        if len(lines) < 2:
            continue
        index = int(lines[0].strip())
        start_str, end_str = [p.strip() for p in lines[1].split("-->")]
        text = "\n".join(lines[2:]).strip()
        segments.append(
            Segment(
                index=index,
                start=_parse_timestamp(start_str),
                end=_parse_timestamp(end_str),
                text=text,
            )
        )
    return segments
