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


def trim_overlaps(segments: list[Segment]) -> list[Segment]:
    """연속된 두 세그먼트의 시간이 겹치면 앞 세그먼트의 끝을 다음 세그먼트의 시작에 맞춰 자른다.
    (긴 오디오를 여러 청크로 나눠 처리할 때 청크 경계에서 흔히 생기는 겹침을 정리)"""
    for i in range(len(segments) - 1):
        if segments[i].end > segments[i + 1].start:
            segments[i].end = segments[i + 1].start
    return segments


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


def _format_ass_timestamp(seconds: float) -> str:
    """초를 ASS 타임스탬프(H:MM:SS.cc, 센티초) 형식으로 변환."""
    if seconds < 0:
        seconds = 0
    total_cs = round(seconds * 100)
    hours, rem_cs = divmod(total_cs, 360_000)
    minutes, rem_cs = divmod(rem_cs, 6_000)
    secs, cs = divmod(rem_cs, 100)
    return f"{hours}:{minutes:02d}:{secs:02d}.{cs:02d}"


def segments_to_ass(segments: list[Segment], style: dict) -> str:
    """세그먼트 목록을 스타일이 적용된 ASS 자막으로 직렬화한다.

    ffmpeg의 subtitles 필터에 SRT+force_style+original_size 조합을 쓰면 일부
    버전/빌드에서 original_size가 실제로 반영되지 않고 libass가 내부 기본값
    (PlayResY=288로 추정)을 써버려, 글자 크기/여백이 의도한 것보다 몇 배 크게
    나오는 문제가 있었다. PlayResX/PlayResY를 스크립트 헤더에 직접 명시하는
    정식 .ass 파일을 만들어 이 문제를 근본적으로 피한다.
    """
    width_percent = max(10, min(100, style.get("width_percent", 90)))
    margin_lr = round(1280 * (1 - width_percent / 100) / 2)
    font_name = style.get("font_name", "Apple SD Gothic Neo")
    font_size = style.get("font_size", 32)
    primary_colour = style.get("primary_colour", "&H00FFFFFF")
    outline_colour = style.get("outline_colour", "&H00000000")
    alignment = style.get("alignment", 2)
    margin_v = style.get("margin_v", 70)

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1280",
        "PlayResY: 720",
        "WrapStyle: 2",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Default,{font_name},{font_size},{primary_colour},&H000000FF,{outline_colour},"
        f"&H00000000,0,0,0,0,100,100,0,0,1,2,1,{alignment},{margin_lr},{margin_lr},{margin_v},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for seg in segments:
        # { } 는 ASS에서 오버라이드 태그로 해석되므로, 자막 본문에 있으면 전각 문자로 바꿔 무력화한다.
        text = seg.text.strip().replace("{", "｛").replace("}", "｝").replace("\n", "\\N")
        seg_end = seg.end
        if seg_end <= seg.start:
            # 길이가 0 이하인(동기화 편집 중 생긴) 구간이 하나라도 있으면 libass가 파일 전체를
            # 잘못 렌더링해 앞쪽 자막까지 안 보이는 현상이 있어(실사용에서 확인된 버그),
            # 최소한의 길이를 보장해 무효 구간이 섞이지 않게 한다.
            seg_end = seg.start + 0.1
        start = _format_ass_timestamp(seg.start)
        end = _format_ass_timestamp(seg_end)
        lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")
    return "\n".join(lines) + "\n"


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
