"""ffmpeg 오디오 추출 + mlx-whisper(애플 실리콘 GPU) 음성 인식 + 자막 굽기."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import mlx_whisper
from mlx_whisper.audio import SAMPLE_RATE, load_audio

from srt_utils import Segment

_MODEL_REPO = "mlx-community/whisper-medium-mlx"
_CHUNK_SECONDS = 300  # 5분 단위로 나눠서 처리 -> 진행률/실시간 자막 업데이트용


class BurnCancelled(Exception):
    """사용자가 굽기를 중간에 중지한 경우."""


def extract_audio(video_path: Path, audio_path: Path) -> None:
    """ffmpeg로 영상에서 16kHz mono wav 오디오를 추출한다."""
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(video_path),
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-f", "wav",
        str(audio_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg 오디오 추출 실패: {result.stderr.strip()[-500:]}")


def extract_audio_compressed(video_path: Path, output_path: Path, bitrate: str = "64k") -> None:
    """다른 기기로 전송하기 쉬운 크기의 압축 mono 오디오(m4a)를 추출한다."""
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(video_path),
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "aac",
        "-b:a", bitrate,
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg 오디오 추출 실패: {result.stderr.strip()[-500:]}")


def get_duration(video_path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
        capture_output=True, text=True,
    )
    return float(result.stdout.strip())


def get_video_bitrate(video_path: Path) -> int | None:
    """원본 영상 자체의 비트레이트(bps)를 가져온다. 구할 수 없으면 None."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=bit_rate,format=bit_rate",
         "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
        capture_output=True, text=True,
    )
    for line in result.stdout.split():
        if line.strip().isdigit():
            return int(line.strip())
    return None


def burn_subtitles(video_path: Path, srt_path: Path, output_path: Path, style: dict, proc_holder: dict | None = None):
    """스타일이 적용된 자막을 영상에 구워 넣으며 (진행률 0~1, 현재 초, 전체 길이(초))를 하나씩 생성한다.

    출력 비트레이트는 원본 영상의 비트레이트에 맞춰 자동으로 정해 파일 크기가
    불필요하게 커지거나 화질이 떨어지지 않게 한다.
    proc_holder를 넘기면 실행 중인 ffmpeg 프로세스를 그 안에 담아둬서,
    호출 측에서 필요할 때 중지시킬 수 있게 한다.
    """
    duration = get_duration(video_path)
    source_bitrate = get_video_bitrate(video_path)
    # 자막을 새로 그려 넣는 과정에서 화질 손실이 살짝 생길 수 있어 10% 여유를 둔다.
    target_bitrate = int(source_bitrate * 1.1) if source_bitrate else 8_000_000
    b_v = f"{target_bitrate}"

    force_style = (
        f"FontName=Apple SD Gothic Neo,"
        f"FontSize={style.get('font_size', 32)},"
        f"PrimaryColour={style.get('primary_colour', '&H00FFFFFF')},"
        f"OutlineColour={style.get('outline_colour', '&H00000000')},"
        f"BorderStyle=1,Outline=2,Shadow=1,"
        f"Alignment={style.get('alignment', 2)},"
        f"MarginV={style.get('margin_v', 70)}"
    )
    # srt 경로에 콜론/특수문자가 있으면 필터 인자 파싱이 깨지므로 이스케이프한다.
    escaped_srt = str(srt_path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    vf = f"subtitles='{escaped_srt}':original_size=1280x720:force_style='{force_style}'"

    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-vf", vf,
        "-c:v", "h264_videotoolbox", "-b:v", b_v,
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
            fraction = min(seconds / duration, 1.0) if duration else 0.0
            yield fraction, seconds, duration
    proc.wait()
    if proc_holder is not None and proc_holder.get("cancelled"):
        raise BurnCancelled("사용자가 중지했습니다.")
    if proc.returncode != 0:
        stderr = proc.stderr.read()
        raise RuntimeError(f"ffmpeg 자막 굽기 실패: {stderr.strip()[-500:]}")


def transcribe_korean(audio_path: Path):
    """오디오를 한국어로 인식하며 (세그먼트, 진행률 0~1)을 하나씩 생성한다.

    긴 오디오를 통째로 한 번에 처리하면 끝날 때까지 진행률을 알 수 없어서,
    _CHUNK_SECONDS 단위로 나눠 순차 처리하며 청크가 끝날 때마다 결과를 내보낸다.
    """
    audio = load_audio(str(audio_path))
    total_samples = len(audio)
    duration = total_samples / SAMPLE_RATE
    chunk_samples = _CHUNK_SECONDS * SAMPLE_RATE

    index = 0
    pos = 0
    while pos < total_samples:
        chunk = audio[pos : pos + chunk_samples]
        offset = pos / SAMPLE_RATE
        result = mlx_whisper.transcribe(chunk, path_or_hf_repo=_MODEL_REPO, language="ko")
        for s in result["segments"]:
            index += 1
            seg = Segment(
                index=index,
                start=offset + s["start"],
                end=offset + s["end"],
                text=s["text"].strip(),
            )
            progress = min(seg.end / duration, 1.0) if duration else 0.0
            yield seg, progress
        pos += chunk_samples
