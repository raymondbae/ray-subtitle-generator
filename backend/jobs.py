"""업로드~STT 작업 상태 관리 (단일 프로세스, in-memory)."""
from __future__ import annotations

import threading
import uuid
from pathlib import Path
from typing import Literal

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

JobStatus = Literal["uploaded", "processing", "done", "error"]


class Job:
    def __init__(self, job_id: str, filename: str):
        self.job_id = job_id
        self.filename = filename
        self.status: JobStatus = "uploaded"
        self.message: str = ""

    @property
    def dir(self) -> Path:
        return DATA_DIR / self.job_id

    @property
    def video_path(self) -> Path:
        return self.dir / "source" / self.filename

    @property
    def audio_path(self) -> Path:
        return self.dir / "audio.wav"

    @property
    def srt_path(self) -> Path:
        return self.dir / "ko.srt"


_jobs: dict[str, Job] = {}
_lock = threading.Lock()


def create_job(filename: str) -> Job:
    job_id = uuid.uuid4().hex[:12]
    job = Job(job_id, filename)
    job.dir.mkdir(parents=True, exist_ok=True)
    (job.dir / "source").mkdir(parents=True, exist_ok=True)
    with _lock:
        _jobs[job_id] = job
    return job


def get_job(job_id: str) -> Job | None:
    with _lock:
        return _jobs.get(job_id)
