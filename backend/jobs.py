"""업로드~STT 작업 상태 관리. 작업 메타데이터는 디스크에도 저장해 서버 재시작 후에도 이력이 남는다."""
from __future__ import annotations

import json
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Literal

from srt_utils import Segment

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

JobStatus = Literal["uploaded", "processing", "done", "error"]


class Job:
    def __init__(
        self,
        job_id: str,
        filename: str,
        source_path: Path | None = None,
        created_at: float | None = None,
    ):
        self.job_id = job_id
        self.filename = filename
        self.status: JobStatus = "uploaded"
        self.message: str = ""
        self.progress: float = 0.0  # 0.0 ~ 1.0
        self.segments: list[Segment] = []  # 처리 중 실시간으로 채워지는 세그먼트
        self.created_at = created_at if created_at is not None else time.time()
        # 로컬 경로를 직접 지정한 경우, 파일을 복사하지 않고 원본 경로를 그대로 사용한다.
        self._source_path = source_path

        # 자막 굽기(hardsub) 작업 상태
        self.burn_status: str = "idle"  # idle | processing | done | error | cancelled
        self.burn_message: str = ""
        self.burn_progress: float = 0.0
        self.burn_proc_holder: dict = {}  # 실행 중인 ffmpeg 프로세스를 담아 중지에 사용
        self.burn_current_seconds: float = 0.0
        self.burn_duration: float = 0.0
        self.burn_output_path: str | None = None

        # 미리보기용 저해상도 프록시 생성 상태 (메모리에만 보관, 재시작 시 리셋되어도 무방)
        self.proxy_generating: bool = False
        self.proxy_proc_holder: dict = {}  # 실행 중인 프록시 ffmpeg 프로세스를 담아, 굽기가 시작되면 양보받기 위해 중지에 사용

        # 무음(말 없는) 구간 잘라내기 작업 상태
        self.cut_status: str = "idle"  # idle | processing | done | error | cancelled
        self.cut_message: str = ""
        self.cut_progress: float = 0.0
        self.cut_proc_holder: dict = {}
        self.cut_current_seconds: float = 0.0
        self.cut_total_seconds: float = 0.0
        self.cut_output_path: str | None = None

    @property
    def dir(self) -> Path:
        return DATA_DIR / self.job_id

    @property
    def video_path(self) -> Path:
        if self._source_path is not None:
            return self._source_path
        return self.dir / "source" / self.filename

    @property
    def audio_path(self) -> Path:
        return self.dir / "audio.wav"

    @property
    def srt_path(self) -> Path:
        return self.dir / "ko.srt"

    @property
    def compressed_audio_path(self) -> Path:
        return self.dir / "audio_small.m4a"

    @property
    def proxy_path(self) -> Path:
        """미리보기 재생용 720p 다운스케일 프록시. 굽기는 이 파일을 쓰지 않고 원본을 그대로 사용한다."""
        return self.dir / "preview.mp4"

    def burn_output_path_for(self, source_path: Path) -> Path:
        """구운 영상은 원본과 같은 디렉토리에, 원본 이름 뒤에 '_자막입힘_생성일시'를 붙여 저장한다.
        여러 번 구워도 이전 결과를 덮어쓰지 않도록 날짜/시간을 붙인다."""
        stamp = time.strftime("%Y%m%d_%H%M")
        return source_path.parent / f"{source_path.stem}_자막입힘_{stamp}.mp4"

    def cut_output_path_for(self, source_path: Path) -> Path:
        """무음 구간을 잘라낸 영상도 원본과 같은 디렉토리에, 날짜/시간을 붙여 저장한다."""
        stamp = time.strftime("%Y%m%d_%H%M")
        return source_path.parent / f"{source_path.stem}_무음컷_{stamp}.mp4"

    @property
    def meta_path(self) -> Path:
        return self.dir / "meta.json"

    def save_meta(self) -> None:
        """job_id, 원본 파일 위치 등 최소한의 메타데이터를 디스크에 남겨 재시작 후에도 이력을 알 수 있게 한다."""
        meta = {
            "filename": self.filename,
            "source_path": str(self._source_path) if self._source_path else None,
            "created_at": self.created_at,
        }
        self.meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")


_jobs: dict[str, Job] = {}
_lock = threading.Lock()


def create_job(filename: str) -> Job:
    job_id = uuid.uuid4().hex[:12]
    job = Job(job_id, filename)
    job.dir.mkdir(parents=True, exist_ok=True)
    (job.dir / "source").mkdir(parents=True, exist_ok=True)
    job.save_meta()
    with _lock:
        _jobs[job_id] = job
    return job


def create_job_from_path(path: Path) -> Job:
    """이미 로컬에 있는 파일을 복사하지 않고 그 경로를 그대로 참조하는 job 생성."""
    job_id = uuid.uuid4().hex[:12]
    job = Job(job_id, path.name, source_path=path)
    job.dir.mkdir(parents=True, exist_ok=True)
    job.save_meta()
    with _lock:
        _jobs[job_id] = job
    return job


def _load_job_from_disk(job_id: str) -> Job | None:
    """in-memory에 없는 job_id를, 서버 재시작 등으로 디스크에만 남아있는 경우 복원한다."""
    job_dir = DATA_DIR / job_id
    meta_path = job_dir / "meta.json"
    if not meta_path.is_file():
        return None
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    source_path = Path(meta["source_path"]) if meta.get("source_path") else None
    job = Job(job_id, meta["filename"], source_path=source_path, created_at=meta.get("created_at"))
    if (job_dir / "ko.srt").is_file():
        job.status = "done"
        job.progress = 1.0
        job.message = "완료"
    return job


def get_job(job_id: str) -> Job | None:
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            return job
        job = _load_job_from_disk(job_id)
        if job is not None:
            _jobs[job_id] = job
        return job


def list_jobs() -> list[dict]:
    """디스크에 남아있는 모든 작업을 최신순으로 나열한다 (서버 재시작 이력도 포함)."""
    if not DATA_DIR.is_dir():
        return []
    result = []
    for job_dir in DATA_DIR.iterdir():
        if not job_dir.is_dir():
            continue
        job = get_job(job_dir.name)
        if job is None:
            continue
        result.append(
            {
                "job_id": job.job_id,
                "filename": job.filename,
                "created_at": job.created_at,
                "has_subtitles": job.srt_path.exists(),
            }
        )
    result.sort(key=lambda j: j["created_at"], reverse=True)
    return result


def delete_job(job_id: str) -> bool:
    """작업 폴더를 디스크에서 완전히 지우고 in-memory 캐시에서도 제거한다."""
    job_dir = DATA_DIR / job_id
    if not job_dir.is_dir():
        return False
    shutil.rmtree(job_dir)
    with _lock:
        _jobs.pop(job_id, None)
    return True
