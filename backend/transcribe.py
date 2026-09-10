"""ffmpeg 오디오 추출 + faster-whisper 음성 인식."""
from __future__ import annotations

import subprocess
from pathlib import Path

from faster_whisper import WhisperModel

from srt_utils import Segment

_MODEL_SIZE = "medium"
_model: WhisperModel | None = None


def get_model() -> WhisperModel:
    """Whisper 모델을 최초 1회만 로드하고 이후 재사용한다."""
    global _model
    if _model is None:
        _model = WhisperModel(_MODEL_SIZE, device="auto", compute_type="auto")
    return _model


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


def transcribe_korean(audio_path: Path) -> list[Segment]:
    """오디오를 한국어로 인식해 세그먼트 목록을 반환한다."""
    model = get_model()
    raw_segments, _info = model.transcribe(str(audio_path), language="ko")
    segments = [
        Segment(index=i, start=s.start, end=s.end, text=s.text.strip())
        for i, s in enumerate(raw_segments, start=1)
    ]
    return segments
