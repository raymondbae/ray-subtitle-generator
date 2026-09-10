# ray-subtitle-generator

한국어 영상의 음성을 자막(.srt)으로 만드는 로컬 도구입니다.

## 흐름

1. 영상을 업로드하면 로컬 `faster-whisper`가 한국어 음성을 인식해 초안 자막(`ko.srt`)을 만듭니다.
2. 웹 UI에서 영상을 재생하며 자막 문장을 직접 검토·수정하고 저장합니다.
3. 완성된 `ko.srt`가 확정되면, 별도로 Claude Code에게 해당 파일을 영어로 번역해 `en.srt`를 만들어 달라고 요청하세요.
   (이 저장소 자체에는 번역 기능이 포함되어 있지 않습니다.)

## 실행 방법

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

브라우저에서 `http://localhost:8000` 접속.

- 영상 업로드 후 자동으로 자막 생성이 시작됩니다 (영상 길이에 따라 시간이 걸릴 수 있습니다).
- 왼쪽에서 영상을 재생하고, 오른쪽 자막 목록에서 문장을 클릭하면 해당 구간으로 이동합니다.
- 자막 텍스트를 클릭해 바로 수정할 수 있고, "자막 저장" 버튼으로 저장합니다.
- "SRT 다운로드" 버튼으로 완성된 `.srt` 파일을 받아 유튜브에 업로드하세요.

## 참고

- Whisper 모델은 기본적으로 `medium`을 사용합니다 (`backend/transcribe.py`의 `_MODEL_SIZE`에서 변경 가능).
- 업로드된 영상/오디오/자막 파일은 `data/` 폴더에 저장되며 git에는 포함되지 않습니다.
