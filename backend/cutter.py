"""자막이 있는(=말이 있는) 구간만 남기고 무음 구간을 잘라내는 컷편집.

별도 음성 감지(VAD) 없이, 이미 Whisper로 만든 자막 타이밍을 "말하는 구간" 지도로
그대로 재사용한다. 자막 줄 앞뒤로 약간의 패딩을 두고, 너무 짧은 무음은 굳이
자르지 않도록 가까운 구간끼리 합친다.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from srt_utils import Segment
from transcribe import BurnCancelled, get_duration, get_video_bitrate


def compute_keep_ranges(
    segments: list[Segment], duration: float, padding: float = 0.5, min_gap: float = 2.0
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


def invert_ranges(ranges: list[tuple[float, float]], duration: float) -> list[tuple[float, float]]:
    """정렬되어 있고 서로 겹치지 않는 ranges(말하는 구간)의 여집합, 즉 그 사이의
    빈 틈(무음 구간)을 반환한다. "무음 구간만 모아서 영상 만들기"에 사용."""
    gaps: list[tuple[float, float]] = []
    cursor = 0.0
    for start, end in ranges:
        if start > cursor:
            gaps.append((cursor, start))
        cursor = max(cursor, end)
    if duration > cursor:
        gaps.append((cursor, duration))
    return gaps


def exclude_range(duration: float, cut_start: float, cut_end: float) -> list[tuple[float, float]]:
    """[cut_start, cut_end] 구간을 통째로 빼고 그 앞/뒤만 남긴다. 자막 작업 중 필요 없다고
    판단한 임의의 구간을 사용자가 직접 표시해서 잘라내는 기능에 쓰인다 - 자막 기반 패딩/
    min_gap 없이, 표시한 지점을 그대로 정확히 자른다."""
    cut_start = max(0.0, min(cut_start, duration))
    cut_end = max(cut_start, min(cut_end, duration))
    ranges = []
    if cut_start > 0:
        ranges.append((0.0, cut_start))
    if cut_end < duration:
        ranges.append((cut_end, duration))
    return ranges


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
    """keep_ranges만 남기고 나머지를 잘라내며 (진행률 0~1, 현재 초, 전체 유지 시간(초))를 하나씩 생성한다.

    구간마다 따로 인코딩한 뒤 concat 데먼서(스트림 복사)로 이어붙인다. 예전에는 select/aselect
    필터 하나에 모든 구간을 몰아넣었는데, 두 가지 실사용 버그가 있었다:
    1) between() 조건을 '+'로 수백 개 이어붙이면 ffmpeg 수식 파서가 "Cannot allocate memory"로
       죽음(구간 326개, 수식 9천자 넘는 경우 재현됨).
    2) 그걸 trim/atrim+concat 필터 그래프로 바꿔도, 같은 입력을 수십~수백 개의 trim 분기로
       나눠 먹이면 뒤쪽 구간 중 일부의 오디오가 통째로 무음이 돼버림(실제 4K 영상으로 재현 -
       12개 구간만 써도 발생, 구간 개수와 무관하게 "여러 분기로 나눠 먹이는 구조" 자체가 원인).
    구간별로 완전히 독립된 ffmpeg 프로세스를 쓰면 이런 분기 간 간섭이 생길 수가 없다.
    """
    total_kept = sum(e - s for s, e in keep_ranges)
    source_bitrate = get_video_bitrate(video_path)
    target_bitrate = int(source_bitrate * 1.1) if source_bitrate else 8_000_000
    time_re = re.compile(r"out_time_ms=(\d+)")

    tmpdir = Path(tempfile.mkdtemp(prefix="cut_silence_"))
    seg_paths: list[Path] = []
    cumulative = 0.0
    cancelled = False
    try:
        for i, (s, e) in enumerate(keep_ranges):
            seg_duration = e - s
            seg_path = tmpdir / f"seg{i:05d}.mp4"
            cmd = [
                "ffmpeg", "-y",
                "-ss", f"{s:.3f}",
                "-hwaccel", "videotoolbox",  # 4K/HEVC 등 무거운 원본의 디코딩도 하드웨어 가속으로
                "-i", str(video_path),
                "-t", f"{seg_duration:.3f}",
                "-c:v", "h264_videotoolbox", "-b:v", str(target_bitrate),
                "-c:a", "aac", "-b:a", "192k",
                "-progress", "pipe:1", "-nostats",
                str(seg_path),
            ]
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if proc_holder is not None:
                proc_holder["proc"] = proc
            for line in proc.stdout:
                m = time_re.search(line)
                if m:
                    seconds = min(int(m.group(1)) / 1_000_000, seg_duration)
                    fraction = min((cumulative + seconds) / total_kept, 1.0) if total_kept else 0.0
                    yield fraction, cumulative + seconds, total_kept
            proc.wait()
            if proc_holder is not None and proc_holder.get("cancelled"):
                cancelled = True
                # SIGTERM을 받은 ffmpeg는 그 시점까지는 정상 재생되는 파일을 남기므로,
                # 중지 시점까지 구운 구간도 "지금까지 구운 파일"에 포함시킨다.
                if seg_path.exists() and seg_path.stat().st_size > 0:
                    seg_paths.append(seg_path)
                break
            if proc.returncode != 0:
                stderr = proc.stderr.read()
                raise RuntimeError(
                    f"ffmpeg 무음 구간 잘라내기 실패({i + 1}/{len(keep_ranges)}번째 구간): {stderr.strip()[-500:]}"
                )
            seg_paths.append(seg_path)
            cumulative += seg_duration

        if seg_paths:
            concat_list = tmpdir / "concat.txt"
            concat_list.write_text(
                "\n".join(f"file '{p.as_posix()}'" for p in seg_paths), encoding="utf-8"
            )
            concat_cmd = [
                "ffmpeg", "-y",
                "-f", "concat", "-safe", "0", "-i", str(concat_list),
                "-c", "copy",
                str(output_path),
            ]
            result = subprocess.run(concat_cmd, capture_output=True, text=True)
            if result.returncode != 0 and not cancelled:
                raise RuntimeError(f"ffmpeg 구간 합치기 실패: {result.stderr.strip()[-500:]}")

        if cancelled:
            raise BurnCancelled("사용자가 중지했습니다.")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
