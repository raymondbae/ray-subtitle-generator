"""FastAPI 앱: 영상 업로드, 자막 생성/조회/수정/다운로드 API."""
from __future__ import annotations

import threading

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import jobs
import transcribe
from srt_utils import Segment, segments_to_srt, srt_to_segments

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


@app.post("/api/videos")
async def upload_video(file: UploadFile):
    if not file.filename:
        raise HTTPException(400, "파일 이름이 없습니다.")
    allowed_ext = (".mp4", ".mov", ".mkv", ".webm", ".m4a", ".wav", ".mp3")
    if not file.filename.lower().endswith(allowed_ext):
        raise HTTPException(400, f"지원하지 않는 파일 형식입니다. ({', '.join(allowed_ext)})")

    job = jobs.create_job(file.filename)
    with open(job.video_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)

    return {"job_id": job.job_id, "filename": job.filename, "status": job.status}


def _run_transcription(job: jobs.Job) -> None:
    with _process_lock:
        try:
            job.status = "processing"
            job.message = "오디오 추출 중..."
            transcribe.extract_audio(job.video_path, job.audio_path)

            job.message = "음성 인식 중... (영상 길이에 따라 시간이 걸릴 수 있습니다)"
            segments = transcribe.transcribe_korean(job.audio_path)

            job.srt_path.write_text(segments_to_srt(segments), encoding="utf-8")
            job.status = "done"
            job.message = "완료"
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
    return {"status": job.status, "message": job.message}


@app.get("/api/videos/{job_id}/video")
def get_video(job_id: str):
    job = jobs.get_job(job_id)
    if job is None or not job.video_path.exists():
        raise HTTPException(404, "영상을 찾을 수 없습니다.")
    return FileResponse(job.video_path)


@app.get("/api/videos/{job_id}/subtitles")
def get_subtitles(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")
    if not job.srt_path.exists():
        raise HTTPException(404, "아직 생성된 자막이 없습니다.")
    segments = srt_to_segments(job.srt_path.read_text(encoding="utf-8"))
    return {"segments": [s.__dict__ for s in segments]}


@app.put("/api/videos/{job_id}/subtitles")
def update_subtitles(job_id: str, body: SubtitlesUpdate):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "존재하지 않는 job_id 입니다.")

    segments = [Segment(**s.model_dump()) for s in body.segments]
    job.srt_path.write_text(segments_to_srt(segments), encoding="utf-8")
    return {"status": "saved"}


@app.get("/api/videos/{job_id}/subtitles/download")
def download_subtitles(job_id: str):
    job = jobs.get_job(job_id)
    if job is None or not job.srt_path.exists():
        raise HTTPException(404, "자막 파일을 찾을 수 없습니다.")
    return FileResponse(job.srt_path, filename="ko.srt", media_type="application/x-subrip")


app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")
