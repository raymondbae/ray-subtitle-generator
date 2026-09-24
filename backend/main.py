"""FastAPI 앱: 영상 업로드, 자막 생성/조회/수정/다운로드 API."""
from __future__ import annotations

import subprocess
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import corrections
import cutter
import filler
import jobs
import preferences
import qa
import transcribe
from srt_utils import Segment, segments_to_srt, srt_to_segments, trim_overlaps

ALLOWED_EXT = (".mp4", ".mov", ".mkv", ".webm", ".m4a", ".wav", ".mp3")

# Python의 mimetypes 기본 추정값이 브라우저 <video>/<audio> 태그에서 재생 안 되는
# 경우가 있어(.m4a -> audio/mp4a-latm 등 비표준 타입), 재생에 필요한 확장자만 직접 매핑한다.
_MEDIA_TYPE_OVERRIDES = {
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
}


def _guess_media_type(path: Path) -> str | None:
    return _MEDIA_TYPE_OVERRIDES.get(path.suffix.lower())

app = FastAPI(title="ray-subtitle-generator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_process_lock = threading.Lock()


class SegmentIn(BaseModel):
    index: int
    start: float
    end: float
    text: str


class SubtitlesUpdate(BaseModel):
    segments: list[SegmentIn]


class LocalPathIn(BaseModel):
    path: str


@app.get("/api/videos")
def list_videos():
    """지금까지 만든 작업 이력을 최신순으로 반환한다 (서버 재시작 이후 이력 포함)."""
    return {"jobs": jobs.list_jobs()}


@app.delete("/api/videos/{job_id}")
def delete_video(job_id: str):
    """작업 이력을 완전히 삭제한다 (영상/오디오/자막 등 관련 파일 전부 제거)."""
    if not jobs.delete_job(job_id):
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")
    return {"status": "deleted"}


class CorrectionIn(BaseModel):
    find: str
    replace: str


@app.get("/api/corrections")
def list_corrections():
    """저장된 찾기/바꾸기 규칙 목록을 반환한다."""
    return {"rules": corrections.load_corrections()}


@app.post("/api/corrections")
def add_correction_endpoint(body: CorrectionIn):
    """전체 바꾸기 규칙을 저장해, 이후 새로 생성되는 자막에 자동으로 적용되게 한다."""
    rules = corrections.add_correction(body.find, body.replace)
    return {"rules": rules}


@app.delete("/api/corrections")
def delete_correction_endpoint(find: str):
    rules = corrections.remove_correction(find)
    return {"rules": rules}


class FillerPhraseIn(BaseModel):
    phrase: str


@app.get("/api/filler-phrases")
def list_filler_phrases():
    """자막에서 자동으로 제외되는 필러 문구(예: '지나갑니다') 목록을 반환한다."""
    return {"phrases": filler.load_phrases()}


@app.post("/api/filler-phrases")
def add_filler_phrase_endpoint(body: FillerPhraseIn):
    return {"phrases": filler.add_phrase(body.phrase)}


@app.delete("/api/filler-phrases")
def delete_filler_phrase_endpoint(phrase: str):
    return {"phrases": filler.remove_phrase(phrase)}


@app.post("/api/pick-file")
def pick_file():
    """macOS 네이티브 파일 선택 창을 열어 사용자가 고른 파일의 절대 경로를 반환한다."""
    script = 'POSIX path of (choose file with prompt "자막을 만들 영상/오디오 파일을 선택하세요")'
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if result.returncode != 0:
        raise HTTPException(400, "파일 선택이 취소되었습니다.")
    return {"path": result.stdout.strip()}


@app.post("/api/videos/local")
def register_local_video(body: LocalPathIn):
    """이미 로컬 디스크에 있는 파일을 복사하지 않고 그 경로를 그대로 참조한다."""
    path = Path(body.path).expanduser().resolve()
    if not path.is_file():
        raise HTTPException(400, f"파일을 찾을 수 없습니다: {path}")
    if not path.name.lower().endswith(ALLOWED_EXT):
        raise HTTPException(400, f"지원하지 않는 파일 형식입니다. ({', '.join(ALLOWED_EXT)})")

    job = jobs.create_job_from_path(path)
    return {"job_id": job.job_id, "filename": job.filename, "status": job.status}


@app.post("/api/videos")
async def upload_video(file: UploadFile):
    if not file.filename:
        raise HTTPException(400, "파일 이름이 없습니다.")
    if not file.filename.lower().endswith(ALLOWED_EXT):
        raise HTTPException(400, f"지원하지 않는 파일 형식입니다. ({', '.join(ALLOWED_EXT)})")

    job = jobs.create_job(file.filename)
    with open(job.video_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)

    return {"job_id": job.job_id, "filename": job.filename, "status": job.status}


@app.post("/api/videos/{job_id}/extract-audio")
def extract_audio_only(job_id: str):
    """다른 기기로 옮기기 쉽도록 압축된 오디오만 추출한다 (자막 생성은 하지 않음)."""
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")
    try:
        transcribe.extract_audio_compressed(job.video_path, job.compressed_audio_path)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, str(e))
    return {"status": "done"}


@app.get("/api/videos/{job_id}/extract-audio/download")
def download_extracted_audio(job_id: str):
    job = jobs.get_job(job_id)
    if job is None or not job.compressed_audio_path.exists():
        raise HTTPException(404, "추출된 오디오를 찾을 수 없습니다.")
    download_name = Path(job.filename).stem + ".m4a"
    return FileResponse(job.compressed_audio_path, filename=download_name, media_type="audio/mp4")


class BurnStyle(BaseModel):
    font_size: int = 32
    primary_colour: str = "&H00FFFFFF"
    outline_colour: str = "&H00000000"
    alignment: int = 2
    margin_v: int = 70
    width_percent: int = 90


class BurnIn(BaseModel):
    source_path: str
    style: BurnStyle


class CutIn(BaseModel):
    source_path: str


@app.get("/api/burn-style")
def get_burn_style():
    """마지막으로 저장된 자막 굽기 스타일(글자 크기/색/위치 등)을 반환한다."""
    return preferences.load_burn_style()


@app.post("/api/burn-style")
def save_burn_style(style: BurnStyle):
    preferences.save_burn_style(style.model_dump())
    return {"status": "saved"}


def _run_burn(job: jobs.Job, source_path: Path, style: dict) -> None:
    job.burn_proc_holder = {}
    output_path = job.burn_output_path_for(source_path)
    try:
        job.burn_status = "processing"
        job.burn_progress = 0.0
        job.burn_message = "자막 굽는 중..."
        for fraction, current_seconds, duration in transcribe.burn_subtitles(
            source_path, job.srt_path, output_path, style, proc_holder=job.burn_proc_holder
        ):
            job.burn_progress = fraction
            job.burn_current_seconds = current_seconds
            job.burn_duration = duration
            job.burn_message = f"자막 굽는 중... ({round(fraction * 100)}%)"
        job.burn_status = "done"
        job.burn_progress = 1.0
        job.burn_output_path = str(output_path)
        job.burn_message = "완료"
    except transcribe.BurnCancelled:
        job.burn_status = "cancelled"
        job.burn_message = "사용자가 중지했습니다."
        output_path.unlink(missing_ok=True)
    except Exception as e:  # noqa: BLE001
        job.burn_status = "error"
        job.burn_message = str(e)


@app.post("/api/videos/{job_id}/burn/cancel")
def cancel_burn(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")
    proc = job.burn_proc_holder.get("proc")
    if job.burn_status != "processing" or proc is None:
        raise HTTPException(400, "진행 중인 굽기 작업이 없습니다.")
    job.burn_proc_holder["cancelled"] = True
    proc.terminate()
    return {"status": "cancelling"}


@app.post("/api/videos/{job_id}/burn")
def start_burn(job_id: str, body: BurnIn):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")
    if not job.srt_path.exists():
        raise HTTPException(400, "완성된 자막이 없습니다.")
    if job.burn_status == "processing":
        raise HTTPException(409, "이미 굽는 중입니다.")
    if job.cut_status == "processing":
        raise HTTPException(409, "무음 구간 잘라내기가 진행 중입니다. 끝난 뒤 다시 시도하세요.")

    source_path = Path(body.source_path).expanduser().resolve()
    if not source_path.is_file():
        raise HTTPException(400, f"영상을 찾을 수 없습니다: {source_path}")

    preferences.save_burn_style(body.style.model_dump())
    _yield_proxy_encoder(job)

    thread = threading.Thread(
        target=_run_burn, args=(job, source_path, body.style.model_dump()), daemon=True
    )
    thread.start()
    return {"status": "processing"}


@app.get("/api/videos/{job_id}/burn/status")
def get_burn_status(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")
    return {
        "status": job.burn_status,
        "message": job.burn_message,
        "progress": job.burn_progress,
        "current_seconds": job.burn_current_seconds,
        "duration": job.burn_duration,
        "output_path": job.burn_output_path,
    }


def _run_cut(job: jobs.Job, source_path: Path) -> None:
    job.cut_proc_holder = {}
    output_path = job.cut_output_path_for(source_path)
    try:
        job.cut_status = "processing"
        job.cut_progress = 0.0
        job.cut_message = "무음 구간 분석 중..."

        segments = srt_to_segments(job.srt_path.read_text(encoding="utf-8"))
        duration = transcribe.get_duration(source_path)
        keep_ranges = cutter.compute_keep_ranges(segments, duration)
        if not keep_ranges:
            raise RuntimeError("남길 구간이 없습니다 (자막이 비어 있음).")

        job.cut_message = "무음 구간 잘라내는 중..."
        for fraction, current_seconds, total_seconds in cutter.cut_silence(
            source_path, keep_ranges, output_path, proc_holder=job.cut_proc_holder
        ):
            job.cut_progress = fraction
            job.cut_current_seconds = current_seconds
            job.cut_total_seconds = total_seconds
            job.cut_message = f"무음 구간 잘라내는 중... ({round(fraction * 100)}%)"

        remapped = cutter.remap_segments(segments, keep_ranges)
        output_path.with_suffix(".srt").write_text(segments_to_srt(remapped), encoding="utf-8")

        job.cut_status = "done"
        job.cut_progress = 1.0
        job.cut_output_path = str(output_path)
        job.cut_message = "완료"
    except transcribe.BurnCancelled:
        job.cut_status = "cancelled"
        job.cut_message = "사용자가 중지했습니다."
        output_path.unlink(missing_ok=True)
    except Exception as e:  # noqa: BLE001
        job.cut_status = "error"
        job.cut_message = str(e)


@app.post("/api/videos/{job_id}/cut-silence/cancel")
def cancel_cut(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")
    proc = job.cut_proc_holder.get("proc")
    if job.cut_status != "processing" or proc is None:
        raise HTTPException(400, "진행 중인 컷편집 작업이 없습니다.")
    job.cut_proc_holder["cancelled"] = True
    proc.terminate()
    return {"status": "cancelling"}


@app.post("/api/videos/{job_id}/cut-silence")
def start_cut(job_id: str, body: CutIn):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")
    if not job.srt_path.exists():
        raise HTTPException(400, "완성된 자막이 없습니다.")
    if job.cut_status == "processing":
        raise HTTPException(409, "이미 잘라내는 중입니다.")
    if job.burn_status == "processing":
        raise HTTPException(409, "굽기가 진행 중입니다. 끝난 뒤 다시 시도하세요.")

    source_path = Path(body.source_path).expanduser().resolve()
    if not source_path.is_file():
        raise HTTPException(400, f"영상을 찾을 수 없습니다: {source_path}")

    _yield_proxy_encoder(job)

    thread = threading.Thread(target=_run_cut, args=(job, source_path), daemon=True)
    thread.start()
    return {"status": "processing"}


@app.get("/api/videos/{job_id}/cut-silence/status")
def get_cut_status(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")
    return {
        "status": job.cut_status,
        "message": job.cut_message,
        "progress": job.cut_progress,
        "current_seconds": job.cut_current_seconds,
        "duration": job.cut_total_seconds,
        "output_path": job.cut_output_path,
    }


def _run_transcription(job: jobs.Job) -> None:
    with _process_lock:
        try:
            job.status = "processing"
            job.progress = 0.0
            job.message = "오디오 추출 중..."
            transcribe.extract_audio(job.video_path, job.audio_path)

            job.progress = 0.05
            job.message = "음성 인식 중..."
            job.segments = []
            for seg, fraction in transcribe.transcribe_korean(job.audio_path):
                job.segments.append(seg)
                job.progress = 0.05 + 0.95 * fraction
                job.message = f"음성 인식 중... ({round(job.progress * 100)}%)"

            job.message = "이상 구간(반복 등) 재확인 중..."
            job.segments = transcribe.retry_hallucinations(job.segments, job.audio_path)

            # 5분 단위 청크로 나눠 처리하다 보니 청크 경계에서 타임스탬프가 겹치는 경우가 있어 정리한다.
            job.segments = trim_overlaps(job.segments)

            # "지나갑니다" 류의 의미 없는 필러성 한 줄은 자막에서 아예 제외한다.
            job.segments = filler.filter_filler_segments(job.segments)

            corrections.apply_corrections(job.segments)
            job.srt_path.write_text(segments_to_srt(job.segments), encoding="utf-8")
            job.status = "done"
            job.progress = 1.0
            job.message = "완료"
            _start_proxy_generation(job)
        except Exception as e:  # noqa: BLE001
            job.status = "error"
            job.message = str(e)


@app.post("/api/videos/{job_id}/transcribe")
def start_transcribe(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")
    if job.status == "processing":
        raise HTTPException(409, "이미 처리 중입니다.")

    thread = threading.Thread(target=_run_transcription, args=(job,), daemon=True)
    thread.start()
    return {"status": "processing"}


@app.get("/api/videos/{job_id}/status")
def get_status(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")
    return {"status": job.status, "message": job.message, "progress": job.progress}


def _run_make_proxy(job: jobs.Job) -> None:
    job.proxy_proc_holder = {}
    try:
        transcribe.make_preview_proxy(job.video_path, job.proxy_path, proc_holder=job.proxy_proc_holder)
    except Exception:  # noqa: BLE001
        pass  # 실패해도 원본으로 계속 서빙되므로 사용자에게 보여줄 필요 없다.
    finally:
        job.proxy_generating = False


def _start_proxy_generation(job: jobs.Job) -> None:
    # 굽기 중에는 하드웨어 인코더(h264_videotoolbox)를 나눠 쓰면 둘 다 느려지므로 미루고,
    # 굽기가 끝난 뒤 다음 재생 요청 때 자연스럽게 다시 시도되게 둔다.
    if job.proxy_path.exists() or job.proxy_generating or job.burn_status == "processing":
        return
    job.proxy_generating = True
    threading.Thread(target=_run_make_proxy, args=(job,), daemon=True).start()


def _yield_proxy_encoder(job: jobs.Job) -> None:
    """굽기/컷편집처럼 무거운 인코딩이 시작될 때, 이미 돌고 있는 프록시 생성이 있으면
    하드웨어 인코더를 양보하도록 중지시킨다."""
    if not job.proxy_generating:
        return
    proc = job.proxy_proc_holder.get("proc")
    if proc is None:
        return
    job.proxy_proc_holder["cancelled"] = True
    proc.terminate()


@app.get("/api/videos/{job_id}/video")
def get_video(job_id: str):
    job = jobs.get_job(job_id)
    if job is None or not job.video_path.exists():
        raise HTTPException(404, "영상을 찾을 수 없습니다.")
    if job.proxy_path.exists():
        return FileResponse(job.proxy_path)
    if job.status == "done":
        _start_proxy_generation(job)
    return FileResponse(job.video_path, media_type=_guess_media_type(job.video_path))


@app.get("/api/videos/{job_id}/subtitles")
def get_subtitles(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")
    # 완료된 뒤에는 저장된 srt 파일을, 처리 중에는 지금까지 인식된 세그먼트를 반환한다.
    if job.srt_path.exists():
        segments = srt_to_segments(job.srt_path.read_text(encoding="utf-8"))
    else:
        segments = job.segments
    return {"segments": qa.annotate(segments)}


@app.put("/api/videos/{job_id}/subtitles")
def update_subtitles(job_id: str, body: SubtitlesUpdate):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")

    segments = [Segment(**s.model_dump()) for s in body.segments]
    job.srt_path.write_text(segments_to_srt(segments), encoding="utf-8")
    return {"status": "saved"}


@app.post("/api/videos/{job_id}/subtitles/upload")
async def upload_subtitles(job_id: str, file: UploadFile):
    """다른 기기에서 이미 완성해둔 SRT 파일을 그대로 붙여서, 인식 과정 없이
    바로 미리보기/검수/굽기가 가능한 상태(done)로 만든다."""
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")
    content = (await file.read()).decode("utf-8", errors="replace")
    try:
        segments = srt_to_segments(content)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"SRT 파일을 읽을 수 없습니다: {e}")
    if not segments:
        raise HTTPException(400, "빈 자막 파일입니다.")

    job.srt_path.write_text(segments_to_srt(segments), encoding="utf-8")
    job.status = "done"
    job.progress = 1.0
    job.message = "완료"
    _start_proxy_generation(job)
    return {"status": "done", "segments": len(segments)}


@app.get("/api/videos/{job_id}/subtitles/download")
def download_subtitles(job_id: str):
    job = jobs.get_job(job_id)
    if job is None or not job.srt_path.exists():
        raise HTTPException(404, "자막 파일을 찾을 수 없습니다.")
    download_name = Path(job.filename).stem + ".srt"
    return FileResponse(job.srt_path, filename=download_name, media_type="application/x-subrip")


app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")
