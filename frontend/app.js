const fileInput = document.getElementById("file-input");
const uploadBtn = document.getElementById("upload-btn");
const statusText = document.getElementById("status-text");
const workspace = document.getElementById("workspace");
const player = document.getElementById("player");
const saveBtn = document.getElementById("save-btn");
const downloadLink = document.getElementById("download-link");
const subtitleList = document.getElementById("subtitle-list");

let jobId = null;
let segments = [];

uploadBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    statusText.textContent = "파일을 선택해주세요.";
    return;
  }

  statusText.textContent = "업로드 중...";
  const formData = new FormData();
  formData.append("file", file);

  const uploadRes = await fetch("/api/videos", { method: "POST", body: formData });
  if (!uploadRes.ok) {
    statusText.textContent = "업로드 실패: " + (await uploadRes.text());
    return;
  }
  const uploadData = await uploadRes.json();
  jobId = uploadData.job_id;

  player.src = `/api/videos/${jobId}/video`;
  downloadLink.href = `/api/videos/${jobId}/subtitles/download`;

  statusText.textContent = "자막 생성 요청 중...";
  await fetch(`/api/videos/${jobId}/transcribe`, { method: "POST" });

  pollStatus();
});

async function pollStatus() {
  const res = await fetch(`/api/videos/${jobId}/status`);
  const data = await res.json();
  statusText.textContent = data.message || data.status;

  if (data.status === "done") {
    await loadSubtitles();
    workspace.hidden = false;
  } else if (data.status === "error") {
    statusText.textContent = "오류: " + data.message;
  } else {
    setTimeout(pollStatus, 2000);
  }
}

async function loadSubtitles() {
  const res = await fetch(`/api/videos/${jobId}/subtitles`);
  const data = await res.json();
  segments = data.segments;
  renderSubtitles();
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function renderSubtitles() {
  subtitleList.innerHTML = "";
  segments.forEach((seg, i) => {
    const row = document.createElement("div");
    row.className = "seg-row";

    const time = document.createElement("div");
    time.className = "seg-time";
    time.textContent = `${formatTime(seg.start)} - ${formatTime(seg.end)}`;

    const text = document.createElement("div");
    text.className = "seg-text";
    text.contentEditable = "true";
    text.textContent = seg.text;
    text.addEventListener("input", () => {
      segments[i].text = text.textContent;
    });

    row.addEventListener("click", (e) => {
      if (e.target !== text) {
        player.currentTime = seg.start;
        player.play();
      }
    });

    row.appendChild(time);
    row.appendChild(text);
    subtitleList.appendChild(row);
  });
}

player.addEventListener("timeupdate", () => {
  const rows = subtitleList.querySelectorAll(".seg-row");
  segments.forEach((seg, i) => {
    const active = player.currentTime >= seg.start && player.currentTime < seg.end;
    rows[i].classList.toggle("active", active);
  });
});

saveBtn.addEventListener("click", async () => {
  const res = await fetch(`/api/videos/${jobId}/subtitles`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segments }),
  });
  statusText.textContent = res.ok ? "저장 완료" : "저장 실패";
});
