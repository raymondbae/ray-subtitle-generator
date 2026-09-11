# ray-subtitle-generator

애플 실리콘 맥에서 로컬로 돌아가는 한국어 영상 자막 생성 도구입니다. 영상을 선택하면 로컬 Whisper(mlx-whisper)가 한국어 자막을 만들어주고, 웹 UI에서 바로 검수·수정한 뒤 SRT로 내보내거나 영상에 직접 구워 넣을 수 있습니다.

## 주요 기능

**자막 생성**
- macOS 파일 선택 창으로 영상/오디오 파일을 고르면 복사 없이 바로 처리 (`.mp4`, `.mov`, `.mkv`, `.webm`, `.m4a`, `.wav`, `.mp3`)
- `mlx-whisper`로 애플 실리콘 GPU를 활용해 빠르게 음성 인식
- 자막이 만들어지는 대로 화면에 실시간으로 스트리밍되어 표시됨
- 긴 영상을 다른 기기로 옮길 때를 위한 "오디오만 추출(압축)" 기능

**자막 검수/편집**
- 영상 위 실시간 자막 오버레이 미리보기
- 반복/할루시네이션 의심 구간 자동 감지 및 표시 (⚠ 아이콘 + 남은 개수 표시)
- "다음 확인 필요 구간" 버튼으로 의심 구간만 골라서 순회
- 문장 클릭 시 바로 텍스트 수정, 영상 위치도 함께 이동
- 전체 찾기/바꾸기 (바뀐 곳으로 자동 이동 + 강조 표시), 바꾼 규칙은 저장되어 다음 자막 생성 시 자동 적용
- 행 삭제, 실행 취소/다시 실행 (Ctrl+Z / Ctrl+Shift+Z)
- 수정하면 자동 저장
- 영상 위치를 직접 옮기면 그 자막으로 자동 스크롤
- 작업 히스토리 (서버 재시작 후에도 유지, 삭제 가능)

**영상에 자막 굽기 (hardsub)**
- 글자 크기/색상/테두리색/위치/여백을 UI에서 조절하며 실시간 미리보기
- 마지막으로 쓴 스타일을 자동으로 기억해 다음에도 그대로 적용
- 원본 영상의 비트레이트에 맞춰 자동으로 인코딩 (파일 크기 과다/화질 저하 방지)
- 실시간 진행률(%, 처리된 시간/전체 길이) 표시, 언제든 중지 가능
- 결과 파일은 원본과 같은 폴더에 `{원본이름}_자막입힘_{생성일시}.mp4`로 저장 (덮어쓰기 없음)

## 설치

### 1. 요구 사항
- 애플 실리콘 Mac (mlx-whisper가 Apple GPU를 사용하기 때문에 Intel Mac은 지원하지 않습니다)
- Python 3.11+
- Homebrew

### 2. ffmpeg 설치 (자막 굽기 기능까지 쓰려면 `ffmpeg-full` 필요)

기본 `ffmpeg`만으로도 자막 생성/추출은 되지만, **영상에 자막을 굽는 기능**은 `libass`가 포함된 빌드가 필요합니다. 이미 기본 `ffmpeg`가 설치되어 있다면 이름이 겹쳐서 먼저 지워야 합니다.

```bash
brew uninstall ffmpeg          # 기존 ffmpeg가 있다면 삭제 (이름 충돌 방지)
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg
```

설치 확인:
```bash
ffmpeg -filters | grep subtitles   # "Render text subtitles onto input video..." 가 나오면 OK
```

### 3. 백엔드 설치

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 실행

```bash
cd backend
uvicorn main:app --port 8000
```

브라우저에서 `http://localhost:8000` 접속.

## 사용 흐름

1. **파일 선택** → 영상/오디오 파일 선택 → **자막 생성 시작**
   (진행률과 함께 자막이 실시간으로 화면에 채워짐)
2. 완료되면 오른쪽 자막 목록에서 검수:
   - ⚠ 표시된 곳 위주로 확인 ("다음 확인 필요 구간" 버튼 활용)
   - 문장 클릭해서 바로 수정 (자동 저장됨)
   - 반복되는 오타/표현은 "전체 바꾸기"로 일괄 수정 (다음 영상부터 자동 적용)
3. **SRT 다운로드**로 자막 파일을 받아 유튜브 등에 자막 트랙으로 업로드
   - 또는 화면 하단 "자막 스타일" 패널에서 크기/색상/위치를 맞춰보고 **영상에 자막 굽기**로 자막이 박힌 영상 파일 생성

## 참고

- Whisper 모델은 `mlx-community/whisper-medium-mlx`를 사용합니다 (`backend/transcribe.py`의 `_MODEL_REPO`에서 변경 가능).
- 영어 자막(번역)은 이 앱에 포함되어 있지 않습니다. 완성된 한글 `.srt`를 Claude Code에게 주고 번역을 요청하는 방식을 권장합니다 (별도 번역 API 비용 없이 처리 가능).
- 업로드/생성된 영상·오디오·자막 파일은 `data/` 폴더에 저장되며 git에는 포함되지 않습니다.
- 찾기/바꾸기 규칙(`data/corrections.json`)과 자막 굽기 스타일 설정(`data/preferences.json`)은 앱 전역 설정으로 저장됩니다.
