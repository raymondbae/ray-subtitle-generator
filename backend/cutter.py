"""자막이 있는(=말이 있는) 구간만 남기고 무음 구간을 잘라내는 컷편집.

별도 음성 감지(VAD) 없이, 이미 Whisper로 만든 자막 타이밍을 "말하는 구간" 지도로
그대로 재사용한다. 자막 줄 앞뒤로 약간의 패딩을 두고, 너무 짧은 무음은 굳이
자르지 않도록 가까운 구간끼리 합친다.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

from srt_utils import Segment
from transcribe import BurnCancelled, get_duration, get_video_bitrate


def compute_keep_ranges(
    segments: list[Segment], duration: float, padding: float = 0.3, min_gap: float = 2.0
) -> list[tuple[float, float]]:
    """각 자막 줄에 패딩을 두른 뒤, 사이 간격이 min_gap보다 좁으면 합쳐서
    시간순으로 정렬되고 서로 겹치지 않는 (start, end) 구간 목록을 만든다."""
    if not segments:
        return []

    padded = sorted(
        (max(0.0, s.start - padding), min(duration, s.end + padding))
        for s in segments
    )

    merged: list[list[float]] = []
    for start, end in padded:
        if merged and start - merged[-1][1] < min_gap:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(s, e) for s, e in merged if e > s]


def remap_segments(segments: list[Segment], keep_ranges: list[tuple[float, float]]) -> list[Segment]:
    """잘라낸 새 타임라인 기준으로 각 세그먼트의 start/end를 다시 계산한다."""
    result: list[Segment] = []
    new_timeline_pos = 0.0
    range_idx = 0

    for seg in segments:
        # 이 세그먼트가 속한 keep_range를 찾을 때까지 누적 위치를 진행시킨다.
        while range_idx < len(keep_ranges) and keep_ranges[range_idx][1] <= seg.start:
            r_start, r_end = keep_ranges[range_idx]
            new_timeline_pos += r_end - r_start
            range_idx += 1
        if range_idx >= len(keep_ranges):
            break

        r_start, r_end = keep_ranges[range_idx]
        offset = r_start - new_timeline_pos  # 원래시간 - 새시간 = offset
        new_start = max(new_timeline_pos, seg.start - offset)
        new_end = min(new_timeline_pos + (r_end - r_start), seg.end - offset)
        if new_end > new_start:
            result.append(Segment(index=len(result) + 1, start=new_start, end=new_end, text=seg.text))

    return result


def cut_silence(video_path: Path, keep_ranges: list[tuple[float, float]], output_path: Path, proc_holder: dict | None = None):
    """keep_ranges만 남기고 나머지를 잘라내며 (진행률 0~1, 현재 초, 전체 유지 시간(초))를 하나씩 생성한다."""
    total_kept = sum(e - s for s, e in keep_ranges)
    source_bitrate = get_video_bitrate(video_path)
    target_bitrate = int(source_bitrate * 1.1) if source_bitrate else 8_000_000

    select_expr = "+".join(f"between(t,{s:.3f},{e:.3f})" for s, e in keep_ranges)
    filter_complex = (
        f"[0:v]select='{select_expr}',setpts=N/FRAME_RATE/TB[v];"
        f"[0:a]aselect='{select_expr}',asetpts=N/SR/TB[a]"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "h264_videotoolbox", "-b:v", str(target_bitrate),
        "-c:a", "aac", "-b:a", "192k",
        "-progress", "pipe:1", "-nostats",
        str(output_path),
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc_holder is not None:
        proc_holder["proc"] = proc
    time_re = re.compile(r"out_time_ms=(\d+)")
    for line in proc.stdout:
        m = time_re.search(line)
        if m:
            seconds = int(m.group(1)) / 1_000_000
            fraction = min(seconds / total_kept, 1.0) if total_kept else 0.0
            yield fraction, seconds, total_kept
    proc.wait()
    if proc_holder is not None and proc_holder.get("cancelled"):
        raise BurnCancelled("사용자가 중지했습니다.")
    if proc.returncode != 0:
        stderr = proc.stderr.read()
        raise RuntimeError(f"ffmpeg 무음 구간 잘라내기 실패: {stderr.strip()[-500:]}")
