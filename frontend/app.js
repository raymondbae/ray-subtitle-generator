const pickFileBtn = document.getElementById("pick-file-btn");
const uploadFileBtn = document.getElementById("upload-file-btn");
const uploadFileInput = document.getElementById("upload-file-input");
const attachSrtBtn = document.getElementById("attach-srt-btn");
const attachSrtInput = document.getElementById("attach-srt-input");
const pickedPathEl = document.getElementById("picked-path");
const startBtn = document.getElementById("start-btn");
const extractAudioBtn = document.getElementById("extract-audio-btn");
const progressWrap = document.getElementById("progress-wrap");
const progressFill = document.getElementById("progress-fill");
const progressMessage = document.getElementById("progress-message");
const progressPercent = document.getElementById("progress-percent");
const workspace = document.getElementById("workspace");
const player = document.getElementById("player");
const captionOverlay = document.getElementById("caption-overlay");
const saveBtn = document.getElementById("save-btn");
const saveStatus = document.getElementById("save-status");
const downloadLink = document.getElementById("download-link");
const subtitleList = document.getElementById("subtitle-list");
const nextFlagBtn = document.getElementById("next-flag-btn");
const deleteRepeatBtn = document.getElementById("delete-repeat-btn");
const deleteAllFlaggedBtn = document.getElementById("delete-all-flagged-btn");
const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");
const findInput = document.getElementById("find-input");
const findNextBtn = document.getElementById("find-next-btn");
const replaceInput = document.getElementById("replace-input");
const replaceAllBtn = document.getElementById("replace-all-btn");
const nextChangedBtn = document.getElementById("next-changed-btn");
const replaceStatus = document.getElementById("replace-status");
const historyBtn = document.getElementById("history-btn");
const historyPanel = document.getElementById("history-panel");
const historyList = document.getElementById("history-list");
const styleFont = document.getElementById("style-font");
const styleSize = document.getElementById("style-size");
const styleSizeVal = document.getElementById("style-size-val");
const styleColor = document.getElementById("style-color");
const styleOutlineColor = document.getElementById("style-outline-color");
const stylePosition = document.getElementById("style-position");
const styleMargin = document.getElementById("style-margin");
const styleMarginVal = document.getElementById("style-margin-val");
const styleWidth = document.getElementById("style-width");
const styleWidthVal = document.getElementById("style-width-val");
const burnPickBtn = document.getElementById("burn-pick-btn");
const burnSourcePath = document.getElementById("burn-source-path");
const burnBtn = document.getElementById("burn-btn");
const burnCancelBtn = document.getElementById("burn-cancel-btn");
const burnProgressWrap = document.getElementById("burn-progress-wrap");
const burnProgressFill = document.getElementById("burn-progress-fill");
const burnProgressMessage = document.getElementById("burn-progress-message");
const burnProgressPercent = document.getElementById("burn-progress-percent");
const cutBtn = document.getElementById("cut-btn");
const cutCancelBtn = document.getElementById("cut-cancel-btn");
const cutInvertCheckbox = document.getElementById("cut-invert-checkbox");
const cutProgressWrap = document.getElementById("cut-progress-wrap");
const cutProgressFill = document.getElementById("cut-progress-fill");
const cutProgressMessage = document.getElementById("cut-progress-message");
const cutProgressPercent = document.getElementById("cut-progress-percent");
const syncSelectedCountEl = document.getElementById("sync-selected-count");
const syncOffsetInput = document.getElementById("sync-offset-input");
const syncBackwardBtn = document.getElementById("sync-backward-btn");
const syncForwardBtn = document.getElementById("sync-forward-btn");
const syncSnapBtn = document.getElementById("sync-snap-btn");
const syncSelectToEndBtn = document.getElementById("sync-select-to-end-btn");
const syncClearBtn = document.getElementById("sync-clear-btn");
const currentTimeDisplay = document.getElementById("current-time-display");
const skipGapsCheckbox = document.getElementById("skip-gaps-checkbox");
const proxyStatusBadge = document.getElementById("proxy-status-badge");
const audioPreviewBadge = document.getElementById("audio-preview-badge");
const avToggleBtn = document.getElementById("av-toggle-btn");
const timelinePanel = document.getElementById("timeline-panel");
const timelineScroll = document.getElementById("timeline-scroll");
const timelineContent = document.getElementById("timeline-content");
const timelineRuler = document.getElementById("timeline-ruler");
const timelineBlocks = document.getElementById("timeline-blocks");
const timelinePlayhead = document.getElementById("timeline-playhead");
const timelineWaveform = document.getElementById("timeline-waveform");
const tlZoomSlider = document.getElementById("tl-zoom-slider");
const tlZoomOutBtn = document.getElementById("tl-zoom-out");
const tlZoomInBtn = document.getElementById("tl-zoom-in");

let jobId = null;
let segments = [];
let pickedPath = null;
let changedIndices = [];
const selectedIndices = new Set();

// --- 타임라인 -----------------------------------------------------------
let tlPxPerSecond = Number(tlZoomSlider.value);
let tlVideoDuration = 0;
let tlWaveformFetchTimer = null;
let tlDragState = null; // 드래그 중일 때만 { index, startX, startLeftPx } 형태로 채워짐
let timelineBlockLabels = []; // 자막 텍스트만 수정됐을 때 전체를 다시 그리지 않고 이 라벨만 갱신하기 위함

function updateTimelineBlockText(index, newText) {
  const entry = timelineBlockLabels[index];
  if (!entry) return;
  entry.label.textContent = newText;
  entry.block.title = entry.overlapping ? `${newText}\n⚠ 다른 자막과 시간이 겹칩니다` : newText;
}

// --- 실행 취소 / 다시 실행 -------------------------------------------------
let history = [];
let historyIndex = -1;
let suppressHistory = false;

function snapshotSegments() {
  return segments.map((s) => ({ ...s }));
}

// --- 자동 저장 ---------------------------------------------------------------
async function saveSegments(showLabel) {
  if (!jobId) return;
  try {
    const res = await fetch(`/api/videos/${jobId}/subtitles`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments }),
    });
    saveStatus.textContent = res.ok ? showLabel : "저장 실패";
  } catch {
    saveStatus.textContent = "저장 실패";
  }
  setTimeout(() => { saveStatus.textContent = ""; }, 2000);
}

function pushHistory() {
  if (suppressHistory) return;
  const snap = snapshotSegments();
  if (historyIndex >= 0 && JSON.stringify(snap) === JSON.stringify(history[historyIndex])) return;
  history = history.slice(0, historyIndex + 1);
  history.push(snap);
  historyIndex = history.length - 1;
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
}

function restoreFromHistory(index) {
  suppressHistory = true;
  segments = history[index].map((s) => ({ ...s }));
  renderAllSegments();
  historyIndex = index;
  updateUndoRedoButtons();
  suppressHistory = false;
  saveSegments("자동 저장됨");
}

undoBtn.addEventListener("click", () => {
  if (historyIndex <= 0) return;
  restoreFromHistory(historyIndex - 1);
});

redoBtn.addEventListener("click", () => {
  if (historyIndex >= history.length - 1) return;
  restoreFromHistory(historyIndex + 1);
});

document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
  e.preventDefault();
  if (e.shiftKey) {
    redoBtn.click();
  } else {
    undoBtn.click();
  }
});

// --- 전체 찾기/바꾸기 -------------------------------------------------------
replaceAllBtn.addEventListener("click", () => {
  const find = findInput.value;
  const replace = replaceInput.value;
  if (!find) {
    replaceStatus.textContent = "찾을 단어를 입력하세요";
    setTimeout(() => { replaceStatus.textContent = ""; }, 2000);
    return;
  }
  let count = 0;
  changedIndices = [];
  segments.forEach((seg, i) => {
    const occurrences = seg.text.split(find).length - 1;
    if (occurrences > 0) {
      count += occurrences;
      seg.text = seg.text.split(find).join(replace);
      changedIndices.push(i);
    }
  });
  renderAllSegments();
  pushHistory();
  saveSegments("자동 저장됨");

  // 이 규칙을 저장해서, 다음에 새로 만드는 자막에도 자동으로 적용되게 한다.
  fetch("/api/corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ find, replace }),
  });

  if (changedIndices.length > 0) {
    nextChangedBtn.hidden = false;
    const rows = subtitleList.querySelectorAll(".seg-row");
    rows[changedIndices[0]]?.scrollIntoView({ block: "center", behavior: "smooth" });
    player.currentTime = segments[changedIndices[0]].start;
  } else {
    nextChangedBtn.hidden = true;
  }

  replaceStatus.textContent = `${count}곳 변경됨 (규칙 저장됨)`;
  setTimeout(() => { replaceStatus.textContent = ""; }, 2000);
});

// 방금 "전체 바꾸기"로 바뀐 위치들을 순서대로 하나씩 돌아본다.
nextChangedBtn.addEventListener("click", () => {
  if (changedIndices.length === 0) return;
  const currentTime = player.currentTime;
  let targetIdx = changedIndices.find((i) => segments[i].start > currentTime + 0.5);
  if (targetIdx === undefined) targetIdx = changedIndices[0];
  player.currentTime = segments[targetIdx].start;
  player.play();
  const rows = subtitleList.querySelectorAll(".seg-row");
  rows[targetIdx]?.scrollIntoView({ block: "center", behavior: "smooth" });
});

// --- 행 삭제 ---------------------------------------------------------------
function deleteSegment(index) {
  segments.splice(index, 1);
  selectedIndices.clear(); // 인덱스가 밀려 선택 상태가 어긋나므로 초기화
  renderAllSegments();
  pushHistory();
  saveSegments("자동 저장됨");
}

// --- 구간 싱크 밀기/당기기 ---------------------------------------------------
function updateSyncSelectedCount() {
  syncSelectedCountEl.textContent = `${selectedIndices.size}개 선택됨`;
}

function requireSelection() {
  if (selectedIndices.size > 0) return true;
  syncSelectedCountEl.textContent = "⚠ 먼저 자막 줄의 체크박스를 선택하세요";
  setTimeout(updateSyncSelectedCount, 2000);
  return false;
}

function shiftIndices(indices, offset) {
  indices.forEach((i) => {
    const seg = segments[i];
    if (!seg) return;
    seg.start = Math.max(0, seg.start + offset);
    seg.end = Math.max(seg.start + 0.1, seg.end + offset);
  });
  renderAllSegments();
  pushHistory();
  saveSegments("자동 저장됨");
}

function shiftSelected(offset) {
  shiftIndices(selectedIndices, offset);
}

function applySyncOffset(sign) {
  if (!requireSelection()) return;
  const amount = Math.abs(Number(syncOffsetInput.value));
  if (!amount) return;
  shiftSelected(amount * sign);
}

// 자막 줄 옆 ◀/▶ 아이콘: 체크 여부와 무관하게 그 줄 하나만 밀거나 당긴다.
function nudgeSegment(index, sign) {
  const amount = Math.abs(Number(syncOffsetInput.value)) || 0.1;
  shiftIndices([index], amount * sign);
}

// "앞으로 밀기" = 더 일찍(빨리) 나오게, "뒤로 밀기" = 더 늦게 나오게
syncBackwardBtn.addEventListener("click", () => applySyncOffset(-1));
syncForwardBtn.addEventListener("click", () => applySyncOffset(1));

// 선택된 줄들 중 가장 앞선 줄의 시작 시각을 "현재 재생 위치"에 맞추고,
// 나머지 선택된 줄들도 같은 만큼(상대 간격을 유지하며) 이동시킨다.
// -> 오프셋을 직접 계산해서 입력할 필요 없이 정확히 맞출 수 있다.
syncSnapBtn.addEventListener("click", () => {
  if (!requireSelection()) return;
  const firstIdx = Math.min(...selectedIndices);
  const seg0 = segments[firstIdx];
  if (!seg0) return;
  const offset = player.currentTime - seg0.start;
  shiftSelected(offset);
});

// 드리프트가 한 지점부터 끝까지 계속되는 경우, 한 줄씩 체크하기 번거로우므로
// 이미 선택된 줄들 중 가장 앞선 줄부터 마지막 줄까지를 한꺼번에 선택에 추가한다.
syncSelectToEndBtn.addEventListener("click", () => {
  if (!requireSelection()) return;
  const fromIdx = Math.min(...selectedIndices);
  for (let i = fromIdx; i < segments.length; i++) {
    selectedIndices.add(i);
  }
  renderAllSegments();
});

syncClearBtn.addEventListener("click", () => {
  selectedIndices.clear();
  renderAllSegments();
});

function renderAllSegments() {
  subtitleList.innerHTML = "";
  segments.forEach((seg, i) => appendSegRow(seg, i));
  updateFlagCount();
  updateSyncSelectedCount();
  renderTimelineBlocks();
}

// URL에 ?job=<id> 가 있으면 새로 생성하지 않고 기존 결과를 바로 불러온다.
window.addEventListener("DOMContentLoaded", async () => {
  const existingJob = new URLSearchParams(location.search).get("job");
  if (!existingJob) return;
  jobId = existingJob;
  await initPlayerSource();
  downloadLink.href = `/api/videos/${jobId}/subtitles/download`;
  workspace.hidden = false;
  await syncSubtitles();
  pushHistory();

  // 굽기 도중 새로고침/재접속했을 수도 있으니, 이미 진행 중이면 진행률 폴링을 이어서 시작한다.
  const burnRes = await fetch(`/api/videos/${jobId}/burn/status`);
  if (burnRes.ok) {
    const burnData = await burnRes.json();
    if (burnData.status === "processing") {
      burnBtn.disabled = true;
      burnCancelBtn.hidden = false;
      pollBurnStatus();
    }
  }

  // 컷편집도 마찬가지로, 이미 진행 중이면 진행률 폴링을 이어서 시작한다.
  const cutRes = await fetch(`/api/videos/${jobId}/cut-silence/status`);
  if (cutRes.ok) {
    const cutData = await cutRes.json();
    if (cutData.status === "processing") {
      cutBtn.disabled = true;
      cutCancelBtn.hidden = false;
      pollCutStatus();
    }
  }

  pollProxyStatus();
});

// 무거운 원본을 억지로 스트리밍하지 않도록, 저용량 프록시가 아직 없으면 이미 뽑아둔
// 오디오(audio.wav)로 먼저 재생을 시작한다 - 자막 싱크는 화면 없이 오디오+타임라인
// 만으로도 충분하고, 4시간짜리 원본처럼 프록시 변환이 오래 걸리는 경우 특히 유용하다.
let audioPreviewAvailable = false;
// player.src를 바꾼 직후에는 player.currentSrc가 곧바로 갱신되지 않아(한 틱 지연),
// currentSrc로 현재 모드를 판단하면 버튼 라벨 등이 한 박자 늦게 표시된다. 그래서
// 전환할 때마다 이 변수를 직접 갱신해 항상 정확한 현재 모드를 갖고 있게 한다.
let usingAudioPreview = false;

function isUsingAudioPreview() {
  return usingAudioPreview;
}

// 재생 위치/재생 상태를 유지한 채로 다른 소스(영상 <-> 오디오)로 갈아탄다.
function switchPlayerSource(url, isAudio) {
  const wasPlaying = !player.paused;
  const resumeAt = player.currentTime;
  player.addEventListener("loadedmetadata", () => {
    player.currentTime = resumeAt;
    if (wasPlaying) player.play();
  }, { once: true });
  player.src = url;
  usingAudioPreview = isAudio;
}

function switchToVideoSource() {
  switchPlayerSource(`/api/videos/${jobId}/video`, false);
}

function switchToAudioSource() {
  switchPlayerSource(`/api/videos/${jobId}/audio-preview`, true);
}

function updateAvToggleLabel() {
  avToggleBtn.textContent = isUsingAudioPreview() ? "🎬 영상으로 재생" : "🎧 음성만 재생";
}

avToggleBtn.addEventListener("click", () => {
  if (isUsingAudioPreview()) {
    switchToVideoSource();
  } else {
    switchToAudioSource();
  }
  updateAvToggleLabel();
});

async function initPlayerSource() {
  // 이 FastAPI 버전은 HEAD를 GET 라우트에 자동으로 매칭해주지 않으므로, 대신 1바이트만
  // 요청하는 Range GET으로 오디오 추출본이 있는지 가볍게 확인한다 (영상/음성 토글 버튼 노출 여부에도 사용).
  const audioRes = await fetch(`/api/videos/${jobId}/audio-preview`, { headers: { Range: "bytes=0-0" } });
  audioPreviewAvailable = audioRes.ok;
  avToggleBtn.hidden = !audioPreviewAvailable;

  const res = await fetch(`/api/videos/${jobId}/status`);
  const data = await res.json();
  if (data.proxy_ready || !audioPreviewAvailable) {
    player.src = `/api/videos/${jobId}/video`;
    usingAudioPreview = false;
  } else {
    player.src = `/api/videos/${jobId}/audio-preview`;
    usingAudioPreview = true;
    audioPreviewBadge.hidden = false;
    fetch(`/api/videos/${jobId}/ensure-proxy`, { method: "POST" }); // /video를 안 거치므로 프록시 생성을 직접 깨워준다
  }
  updateAvToggleLabel();
}

// 원본 대신 재생할 저용량 미리보기 프록시가 아직 만들어지는 중이면, 그동안 원본을
// 그대로 스트리밍하느라 미리보기가 끊길 수 있어 사용자에게 그 사실을 알려준다.
async function pollProxyStatus() {
  if (!jobId) return;
  const res = await fetch(`/api/videos/${jobId}/status`);
  if (!res.ok) return;
  const data = await res.json();
  if (data.proxy_generating) {
    const percent = Math.round((data.proxy_progress || 0) * 100);
    proxyStatusBadge.textContent = `🎞 미리보기용 저용량 변환 중... (${percent}%, 끝나면 자동으로 끊김 없이 재생됩니다)`;
    proxyStatusBadge.hidden = false;
    setTimeout(pollProxyStatus, 2000);
  } else {
    proxyStatusBadge.hidden = true;
    if (data.proxy_ready && isUsingAudioPreview()) {
      audioPreviewBadge.hidden = true;
      switchToVideoSource();
      updateAvToggleLabel();
    }
  }
}

// --- 작업 히스토리 -----------------------------------------------------------
function formatDate(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function loadHistory() {
  historyList.innerHTML = "";
  const res = await fetch("/api/videos");
  if (!res.ok) return;
  const data = await res.json();
  if (data.jobs.length === 0) {
    historyList.innerHTML = '<div class="history-empty">아직 작업 이력이 없습니다.</div>';
    return;
  }
  data.jobs.forEach((job) => {
    const item = document.createElement("div");
    item.className = "history-item";

    const name = document.createElement("div");
    name.className = "h-name";
    name.textContent = job.filename;

    const badge = document.createElement("div");
    badge.className = "h-badge";
    badge.textContent = job.has_subtitles ? "완료" : "미완료";

    const date = document.createElement("div");
    date.className = "h-date";
    date.textContent = formatDate(job.created_at);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "seg-delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.title = "이 작업 이력 삭제";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`"${job.filename}" 작업 이력을 완전히 삭제할까요? (관련 파일 전부 제거됨)`)) return;
      await fetch(`/api/videos/${job.job_id}`, { method: "DELETE" });
      await loadHistory();
    });

    item.addEventListener("click", () => {
      location.href = `/?job=${job.job_id}`;
    });

    item.appendChild(name);
    item.appendChild(badge);
    item.appendChild(date);
    item.appendChild(deleteBtn);
    historyList.appendChild(item);
  });
}

historyBtn.addEventListener("click", async () => {
  historyPanel.hidden = !historyPanel.hidden;
  if (!historyPanel.hidden) {
    await loadHistory();
  }
});

function setProgress(message, fraction) {
  progressWrap.hidden = false;
  progressMessage.textContent = message;
  const percent = Math.round((fraction || 0) * 100);
  progressPercent.textContent = `${percent}%`;
  progressFill.style.width = `${percent}%`;
}

pickFileBtn.addEventListener("click", async () => {
  setProgress("파일 선택 창을 여는 중...", 0);
  const res = await fetch("/api/pick-file", { method: "POST" });
  progressWrap.hidden = true;
  if (!res.ok) {
    return;
  }
  const data = await res.json();
  pickedPath = data.path;
  jobId = null;
  pickedPathEl.textContent = pickedPath;
  startBtn.disabled = false;
  extractAudioBtn.disabled = false;
});

// 원격(다른 기기)에서 접속했을 때를 위해, 서버 로컬 파일 선택 대신 브라우저에서
// 직접 파일을 골라 서버로 업로드한다 (음성 파일처럼 작은 파일을 옮길 때 유용).
uploadFileBtn.addEventListener("click", () => uploadFileInput.click());

uploadFileInput.addEventListener("change", async () => {
  const file = uploadFileInput.files[0];
  uploadFileInput.value = ""; // 같은 파일을 다시 선택해도 change가 발생하도록 초기화
  if (!file) return;

  setProgress(`업로드 중... (${file.name})`, 0);
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await fetch("/api/videos", { method: "POST", body: formData });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const data = await res.json();
    jobId = data.job_id;
    window.history.replaceState(null, "", `?job=${jobId}`); // 새로고침해도 이 job으로 이어지도록 주소창에 반영
    pickedPath = null; // 로컬 경로가 아니라 이미 서버에 업로드된 job이므로
    pickedPathEl.textContent = `업로드됨: ${data.filename}`;
    startBtn.disabled = false;
    extractAudioBtn.disabled = true; // 이미 서버에 있는 파일이라 "다른 기기로 전송용 추출"은 의미 없음
    progressWrap.hidden = true;
  } catch (e) {
    setProgress("업로드 실패: " + e.message, 0);
  }
});

// 선택된 경로를 아직 등록하지 않았다면 job으로 등록하고 job_id를 반환한다.
async function ensureJob() {
  if (jobId) return jobId;
  const res = await fetch("/api/videos/local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: pickedPath }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const data = await res.json();
  jobId = data.job_id;
  window.history.replaceState(null, "", `?job=${jobId}`); // 새로고침해도 이 job으로 이어지도록 주소창에 반영
  player.src = `/api/videos/${jobId}/video`;
  downloadLink.href = `/api/videos/${jobId}/subtitles/download`;
  return jobId;
}

// 다른 기기(M1 등)에서 이미 완성해둔 SRT를 영상과 짝지어 붙인다.
// 인식 과정 없이 바로 검수/미리보기/굽기가 가능한 상태로 넘어간다.
attachSrtBtn.addEventListener("click", () => {
  if (!pickedPath && !jobId) {
    alert("먼저 영상을 선택하거나 업로드하세요.");
    return;
  }
  attachSrtInput.click();
});

attachSrtInput.addEventListener("change", async () => {
  const file = attachSrtInput.files[0];
  attachSrtInput.value = "";
  if (!file) return;

  setProgress(`SRT 붙이는 중... (${file.name})`, 0);
  try {
    await ensureJob();
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/videos/${jobId}/subtitles/upload`, { method: "POST", body: formData });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    progressWrap.hidden = true;
    workspace.hidden = false;
    segments = [];
    subtitleList.innerHTML = "";
    history = [];
    historyIndex = -1;
    updateUndoRedoButtons();
    await finalizeSubtitles();
    pushHistory();
  } catch (e) {
    setProgress("SRT 붙이기 실패: " + e.message, 0);
  }
});

startBtn.addEventListener("click", async () => {
  if (!pickedPath && !jobId) return;
  startBtn.disabled = true;
  extractAudioBtn.disabled = true;
  pickFileBtn.disabled = true;

  try {
    setProgress("파일 확인 중...", 0);
    await ensureJob();
  } catch (e) {
    setProgress("실패: " + e.message, 0);
    startBtn.disabled = false;
    extractAudioBtn.disabled = false;
    pickFileBtn.disabled = false;
    return;
  }

  segments = [];
  subtitleList.innerHTML = "";
  history = [];
  historyIndex = -1;
  updateUndoRedoButtons();

  setProgress("자막 생성 요청 중...", 0);
  await fetch(`/api/videos/${jobId}/transcribe`, { method: "POST" });

  pollStatus();
});

extractAudioBtn.addEventListener("click", async () => {
  if (!pickedPath) return;
  extractAudioBtn.disabled = true;

  try {
    setProgress("오디오만 추출하는 중... (전송하기 쉬운 크기로 압축)", 0);
    await ensureJob();
    const res = await fetch(`/api/videos/${jobId}/extract-audio`, { method: "POST" });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    setProgress("추출 완료 - 다운로드를 시작합니다", 1);

    const a = document.createElement("a");
    a.href = `/api/videos/${jobId}/extract-audio/download`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => { progressWrap.hidden = true; }, 1500);
  } catch (e) {
    setProgress("실패: " + e.message, 0);
  } finally {
    extractAudioBtn.disabled = false;
  }
});

async function pollStatus() {
  const res = await fetch(`/api/videos/${jobId}/status`);
  const data = await res.json();
  setProgress(data.message || data.status, data.progress);

  if (data.status === "processing" || data.status === "done") {
    workspace.hidden = false;
    await syncSubtitles();
  }

  if (data.status === "done") {
    progressWrap.hidden = true;
    await finalizeSubtitles();
    pushHistory();
  } else if (data.status === "error") {
    progressMessage.textContent = "오류: " + data.message;
  } else {
    setTimeout(pollStatus, 1000);
  }
}

// 처리 중에도 지금까지 인식된 세그먼트를 가져와, 새로 생긴 것만 화면에 실시간으로 추가한다.
async function syncSubtitles() {
  const res = await fetch(`/api/videos/${jobId}/subtitles`);
  if (!res.ok) return;
  const data = await res.json();
  if (data.segments.length <= segments.length) return;

  const newOnes = data.segments.slice(segments.length);
  for (const seg of newOnes) {
    const index = segments.length;
    segments.push(seg);
    appendSegRow(seg, index);
  }
  subtitleList.scrollTop = subtitleList.scrollHeight;
  updateFlagCount();
  // 새로고침 시 영상 메타데이터 로드(-> initTimeline)와 이 자막 불러오기가 경쟁 상태라,
  // 타임라인이 먼저 그려지면 자막이 비어 보일 수 있어 여기서도 다시 그려서 맞춰준다.
  renderTimelineBlocks();
}

// 자막 생성이 끝나면, 처리 중 스트리밍된 것과 개수가 다를 수 있으므로(할루시네이션/필러
// 제거로 줄어들 수 있음) 최종본으로 통째로 다시 불러와 화면을 맞추고 확인 필요 개수를 알려준다.
async function finalizeSubtitles() {
  const res = await fetch(`/api/videos/${jobId}/subtitles`);
  if (!res.ok) return;
  const data = await res.json();
  segments = data.segments;
  renderAllSegments();
  const flagCount = segments.filter((s) => s.flag).length;
  if (flagCount > 0) {
    alert(`자막 생성이 끝났습니다.\n⚠ 확인이 필요한 구간이 ${flagCount}곳 있어요 ("다음 확인 필요 구간" 버튼으로 하나씩 훑어보세요).`);
  }
  // 지금까지는 전사 중이던 원본을 그대로 틀고 있었으니, 프록시가 아직이면 오디오로 전환한다.
  await initPlayerSource();
  pollProxyStatus();
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function appendSegRow(seg, index) {
  const row = document.createElement("div");
  row.className = "seg-row";
  if (seg.flag) {
    row.classList.add("flagged");
    row.title = seg.flag;
  }
  if (changedIndices.includes(index)) {
    row.classList.add("just-changed");
  }
  if (selectedIndices.has(index)) {
    row.classList.add("selected");
  }

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "seg-select";
  checkbox.checked = selectedIndices.has(index);
  checkbox.title = "싱크 이동 대상으로 선택";
  checkbox.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      selectedIndices.add(index);
    } else {
      selectedIndices.delete(index);
    }
    row.classList.toggle("selected", checkbox.checked);
    updateSyncSelectedCount();
  });

  const playBtn = document.createElement("button");
  playBtn.className = "seg-play-btn";
  playBtn.textContent = "▷";
  playBtn.title = "이 위치부터 재생";
  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    player.currentTime = seg.start;
    player.play();
  });

  const time = document.createElement("div");
  time.className = "seg-time";
  time.textContent = `${formatTime(seg.start)} - ${formatTime(seg.end)}`;

  const nudgeBackBtn = document.createElement("button");
  nudgeBackBtn.className = "seg-nudge-btn";
  nudgeBackBtn.textContent = "◀";
  nudgeBackBtn.title = "이 줄만 앞으로 밀기 (더 일찍)";
  nudgeBackBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    nudgeSegment(index, -1);
  });

  const nudgeForwardBtn = document.createElement("button");
  nudgeForwardBtn.className = "seg-nudge-btn";
  nudgeForwardBtn.textContent = "▶";
  nudgeForwardBtn.title = "이 줄만 뒤로 밀기 (더 늦게)";
  nudgeForwardBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    nudgeSegment(index, 1);
  });

  const flagIcon = document.createElement("div");
  flagIcon.className = "flag-icon";
  flagIcon.textContent = "⚠";
  flagIcon.hidden = !seg.flag;

  const text = document.createElement("div");
  text.className = "seg-text";
  text.contentEditable = "true";
  text.textContent = seg.text;
  const originalFlaggedText = seg.text;
  text.addEventListener("input", () => {
    segments[index].text = text.textContent;
    updateTimelineBlockText(index, text.textContent);
    // 플래그된 줄을 실제로 고치면, 그 순간 확인 완료로 보고 표시를 지운다.
    if (seg.flag && text.textContent !== originalFlaggedText) {
      seg.flag = null;
      row.classList.remove("flagged");
      row.title = "";
      flagIcon.hidden = true;
      updateFlagCount();
    }
  });
  text.addEventListener("focus", () => {
    player.pause();
  });
  text.addEventListener("blur", () => {
    pushHistory();
    saveSegments("자동 저장됨");
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "seg-delete-btn";
  deleteBtn.textContent = "✕";
  deleteBtn.title = "이 줄 삭제";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteSegment(index);
  });

  row.appendChild(checkbox);
  row.appendChild(playBtn);
  row.appendChild(time);
  row.appendChild(nudgeBackBtn);
  row.appendChild(nudgeForwardBtn);
  row.appendChild(flagIcon);
  row.appendChild(text);
  row.appendChild(deleteBtn);
  subtitleList.appendChild(row);
}

// 남은 "확인 필요" 개수를 버튼에 표시한다.
function updateFlagCount() {
  const count = segments.filter((s) => s.flag).length;
  nextFlagBtn.textContent = count > 0 ? `⚠ 다음 확인 필요 구간 (${count})` : "확인할 구간 없음";
  nextFlagBtn.disabled = count === 0;
}

// 현재 재생 위치 다음에 있는 가장 가까운 "확인 필요" 구간으로 이동한다.
nextFlagBtn.addEventListener("click", () => {
  const currentTime = player.currentTime;
  let target = segments.find((seg) => seg.flag && seg.start > currentTime + 0.5);
  if (!target) {
    target = segments.find((seg) => seg.flag); // 끝까지 갔으면 처음 것부터 다시
  }
  if (!target) {
    saveStatus.textContent = "확인이 필요한 구간이 없습니다";
    setTimeout(() => { saveStatus.textContent = ""; }, 2000);
    return;
  }
  player.currentTime = target.start;
  player.play();
  const rows = subtitleList.querySelectorAll(".seg-row");
  const idx = segments.indexOf(target);
  rows[idx]?.scrollIntoView({ block: "center", behavior: "smooth" });
});

// 지금 재생 중인 자막과 같은 문장이 앞뒤로 연속 반복되는 구간을 한번에 찾아 지운다.
// (예: "이곳은 전국의 한 지방에 있는 한 곳입니다." 같은 문장이 10줄 넘게 똑같이 반복되는 할루시네이션)
deleteRepeatBtn.addEventListener("click", () => {
  const idx = segments.findIndex((seg) => player.currentTime >= seg.start && player.currentTime < seg.end);
  if (idx === -1) {
    alert("먼저 반복되는 자막 줄을 재생 중인 상태에서 눌러주세요 (▷ 버튼으로 재생).");
    return;
  }
  const text = segments[idx].text.trim();
  if (!text) return;
  let start = idx;
  let end = idx;
  while (start > 0 && segments[start - 1].text.trim() === text) start--;
  while (end < segments.length - 1 && segments[end + 1].text.trim() === text) end++;
  const count = end - start + 1;
  if (count <= 1) {
    alert(`"${text}"\n앞뒤로 똑같이 반복되는 줄이 없어요 (이 줄 하나뿐).`);
    return;
  }
  if (!confirm(`"${text}"\n이 문장이 연속으로 ${count}번 반복되고 있어요. 전부 삭제할까요?`)) return;
  segments.splice(start, count);
  renderAllSegments();
  pushHistory();
  saveSegments("자동 저장됨");
});

// ⚠ 표시된("확인 필요") 줄을 전부 한번에 지운다. 헛소리/잡음이 너무 광범위하게
// 껴 있어서 하나씩 확인하기보다 그냥 다 지우고 싶을 때 사용 (실행취소로 되돌릴 수 있음).
deleteAllFlaggedBtn.addEventListener("click", () => {
  const flaggedCount = segments.filter((s) => s.flag).length;
  if (flaggedCount === 0) {
    alert("확인이 필요한 구간이 없습니다.");
    return;
  }
  if (!confirm(`⚠ 확인 필요 표시된 ${flaggedCount}개 줄을 전부 삭제할까요?\n(실행취소(Ctrl+Z)로 되돌릴 수 있습니다)`)) return;
  segments = segments.filter((s) => !s.flag);
  renderAllSegments();
  pushHistory();
  saveSegments("자동 저장됨");
});

// 단어 검색: 현재 재생 위치 다음에 있는 첫 매치로 이동 (계속 누르면 다음 매치로 순환)
function findNext() {
  const query = findInput.value.trim();
  if (!query) {
    replaceStatus.textContent = "찾을 단어를 입력하세요";
    setTimeout(() => { replaceStatus.textContent = ""; }, 2000);
    return;
  }
  const currentTime = player.currentTime;
  let target = segments.find((seg) => seg.text.includes(query) && seg.start > currentTime + 0.5);
  if (!target) {
    target = segments.find((seg) => seg.text.includes(query)); // 끝까지 갔으면 처음부터 다시
  }
  if (!target) {
    replaceStatus.textContent = "일치하는 자막이 없습니다";
    setTimeout(() => { replaceStatus.textContent = ""; }, 2000);
    return;
  }
  player.currentTime = target.start;
  player.play();
  const rows = subtitleList.querySelectorAll(".seg-row");
  const idx = segments.indexOf(target);
  rows[idx]?.scrollIntoView({ block: "center", behavior: "smooth" });
}

findNextBtn.addEventListener("click", findNext);
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    findNext();
  }
});

player.addEventListener("timeupdate", () => {
  const rows = subtitleList.querySelectorAll(".seg-row");
  let activeSeg = null;
  segments.forEach((seg, i) => {
    const active = player.currentTime >= seg.start && player.currentTime < seg.end;
    rows[i].classList.toggle("active", active);
    if (active) activeSeg = seg;
  });
  captionOverlay.textContent = activeSeg ? activeSeg.text : "";
  currentTimeDisplay.textContent = `현재 ${formatTime(player.currentTime)} (${player.currentTime.toFixed(2)}s)`;
  updateTimelinePlayhead();

  // 재생 중 자막이 없는(무음 등) 구간이면 다음 자막 시작 지점으로 바로 건너뛴다.
  if (!activeSeg && skipGapsCheckbox.checked && !player.paused) {
    const next = segments.find((seg) => seg.start > player.currentTime);
    if (next) player.currentTime = next.start;
  }
});

player.addEventListener("loadedmetadata", initTimeline);

// 재생 중 자연스러운 흐름이 아니라, 사용자가 영상 위치를 직접 옮겼을 때만 그 자막으로 스크롤한다.
player.addEventListener("seeked", () => {
  const idx = segments.findIndex((seg) => player.currentTime >= seg.start && player.currentTime < seg.end);
  if (idx === -1) return;
  const rows = subtitleList.querySelectorAll(".seg-row");
  rows[idx]?.scrollIntoView({ block: "center", behavior: "smooth" });
});

saveBtn.addEventListener("click", () => {
  saveSegments("저장 완료");
});

// --- 자막 스타일 실시간 미리보기 ---------------------------------------------
// 실제 굽기(burn_subtitles)는 항상 1280 너비를 기준(original_size=1280x720)으로
// 글자 크기/여백을 계산하므로, 미리보기도 영상이 실제 화면에서 렌더링된 폭에 맞춰
// 그 비율만큼 확대/축소해야 굽기 결과와 동일하게 보인다 (영상 카드가 커지면 자막도 커짐).
function getCaptionScale() {
  return (player.clientWidth || 1280) / 1280;
}

function applyCaptionStyle() {
  const scale = getCaptionScale();
  captionOverlay.style.fontFamily = `"${styleFont.value}"`;
  captionOverlay.style.setProperty("--cap-size", styleSize.value * scale);
  captionOverlay.style.setProperty("--cap-color", styleColor.value);
  captionOverlay.style.setProperty("--cap-outline", styleOutlineColor.value);
  captionOverlay.style.setProperty("--cap-margin", `${styleMargin.value * scale}px`);
  captionOverlay.style.setProperty("--cap-width", `${styleWidth.value}%`);
  captionOverlay.classList.remove("pos-top", "pos-middle");
  if (stylePosition.value === "top") captionOverlay.classList.add("pos-top");
  if (stylePosition.value === "middle") captionOverlay.classList.add("pos-middle");
  styleSizeVal.textContent = styleSize.value;
  styleMarginVal.textContent = styleMargin.value;
  styleWidthVal.textContent = styleWidth.value;
}

function currentStyleForSave() {
  const alignment = stylePosition.value === "top" ? 8 : stylePosition.value === "middle" ? 5 : 2;
  return {
    font_size: Number(styleSize.value),
    font_name: styleFont.value,
    primary_colour: hexToAssColor(styleColor.value),
    outline_colour: hexToAssColor(styleOutlineColor.value),
    alignment,
    margin_v: Number(styleMargin.value),
    width_percent: Number(styleWidth.value),
  };
}

function saveBurnStylePrefs() {
  fetch("/api/burn-style", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentStyleForSave()),
  });
}

new ResizeObserver(applyCaptionStyle).observe(player);

[styleFont, styleSize, styleColor, styleOutlineColor, stylePosition, styleMargin, styleWidth].forEach((el) => {
  el.addEventListener("input", applyCaptionStyle);
  el.addEventListener("change", saveBurnStylePrefs);
});

// 색상 피커를 직접 열지 않고도 자주 쓰는 색을 한 번에 고를 수 있는 샘플 스와치
document.querySelectorAll(".color-presets").forEach((group) => {
  const target = document.getElementById(group.dataset.target);
  group.querySelectorAll(".color-swatch").forEach((swatch) => {
    swatch.addEventListener("click", () => {
      target.value = swatch.dataset.color;
      applyCaptionStyle();
      saveBurnStylePrefs();
    });
  });
});
applyCaptionStyle();

// 마지막으로 저장된 스타일을 불러와 컨트롤에 반영한다.
async function loadBurnStylePrefs() {
  try {
    const res = await fetch("/api/burn-style");
    if (!res.ok) return;
    const style = await res.json();
    styleFont.value = style.font_name || "Apple SD Gothic Neo";
    styleSize.value = style.font_size;
    styleColor.value = assColorToHex(style.primary_colour);
    styleOutlineColor.value = assColorToHex(style.outline_colour);
    stylePosition.value = style.alignment === 8 ? "top" : style.alignment === 5 ? "middle" : "bottom";
    styleMargin.value = style.margin_v;
    styleWidth.value = style.width_percent || 90;
    applyCaptionStyle();
  } catch {
    // 저장된 값이 없거나 실패하면 기본값 그대로 사용
  }
}
loadBurnStylePrefs();

// --- 영상에 자막 굽기 --------------------------------------------------------
function hexToAssColor(hex) {
  // "#rrggbb" -> ASS 색상 형식 "&H00BBGGRR"
  const r = hex.slice(1, 3), g = hex.slice(3, 5), b = hex.slice(5, 7);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function assColorToHex(ass) {
  // "&H00BBGGRR" -> "#rrggbb"
  const hex6 = ass.replace("&H", "").slice(-6);
  const b = hex6.slice(0, 2), g = hex6.slice(2, 4), r = hex6.slice(4, 6);
  return `#${r}${g}${b}`.toLowerCase();
}

let burnSourcePathValue = null;

function formatHMS(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// --- 캡컷 스타일 타임라인 -----------------------------------------------------
function initTimeline() {
  tlVideoDuration = player.duration || 0;
  if (!tlVideoDuration) return;
  timelinePanel.hidden = false;
  timelineContent.style.width = `${tlVideoDuration * tlPxPerSecond}px`;
  renderTimelineRuler();
  renderTimelineBlocks();
  updateTimelinePlayhead();
  requestWaveformRedraw();
}

function niceTickInterval(pxPerSecond) {
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const targetPx = 80;
  return candidates.find((sec) => sec * pxPerSecond >= targetPx) || candidates[candidates.length - 1];
}

function renderTimelineRuler() {
  timelineRuler.innerHTML = "";
  if (!tlVideoDuration) return;
  const interval = niceTickInterval(tlPxPerSecond);
  for (let t = 0; t <= tlVideoDuration; t += interval) {
    const tick = document.createElement("div");
    tick.className = "timeline-tick";
    tick.style.left = `${t * tlPxPerSecond}px`;
    tick.textContent = formatHMS(t);
    timelineRuler.appendChild(tick);
  }
}

// 시간순으로 겹치는 자막이 있으면(자막 하나가 시작하기 전에 다른 자막이 안 끝났으면)
// 서로 겹치는 인덱스들을 모아 반환한다. start 기준 정렬돼 있다고 가정하고, 겹치지
// 않는 지점을 만나면 더 볼 필요가 없어 바로 break한다.
function computeOverlappingIndices() {
  const overlapping = new Set();
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[j].start >= segments[i].end) break;
      overlapping.add(i);
      overlapping.add(j);
    }
  }
  return overlapping;
}

// 겹치는 자막끼리는 같은 줄에 그리면 한쪽이 가려지므로, 겹치지 않을 때까지
// 아래로 새 레인(줄)을 만들어 배정한다 (간단한 구간 스케줄링 그리디).
function assignTimelineLanes() {
  const laneEnds = [];
  return segments.map((seg) => {
    let lane = laneEnds.findIndex((end) => end <= seg.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(seg.end);
    } else {
      laneEnds[lane] = seg.end;
    }
    return lane;
  });
}

const TL_LANE_HEIGHT = 40; // 블록 높이(36px) + 위아래 여백

function renderTimelineBlocks() {
  if (!tlVideoDuration) return;
  timelineBlocks.innerHTML = "";
  const overlapping = computeOverlappingIndices();
  const lanes = assignTimelineLanes();
  const laneCount = Math.max(1, ...lanes.map((l) => l + 1));
  timelineBlocks.style.height = `${laneCount * TL_LANE_HEIGHT + 4}px`;
  timelineContent.style.height = `${40 + laneCount * TL_LANE_HEIGHT + 4}px`;
  timelineScroll.style.height = `${40 + laneCount * TL_LANE_HEIGHT + 4}px`;

  timelineBlockLabels = [];
  segments.forEach((seg, index) => {
    const block = document.createElement("div");
    block.className = "timeline-block";
    if (seg.flag) block.classList.add("flagged");
    if (overlapping.has(index)) block.classList.add("overlapping");
    block.style.left = `${seg.start * tlPxPerSecond}px`;
    block.style.top = `${4 + lanes[index] * TL_LANE_HEIGHT}px`;
    block.style.width = `${Math.max(2, (seg.end - seg.start) * tlPxPerSecond)}px`;
    block.addEventListener("pointerdown", (e) => startTimelineDrag(e, index, block));

    // 텍스트를 block.textContent로 직접 넣으면 resize 손잡이 div까지 지워버리므로,
    // 텍스트 전용 span에 넣어 자막 수정 시 이 span만 targeted하게 갱신할 수 있게 한다.
    const label = document.createElement("span");
    label.className = "timeline-block-label";
    label.textContent = seg.text;
    block.title = overlapping.has(index) ? `${seg.text}\n⚠ 다른 자막과 시간이 겹칩니다` : seg.text;
    block.appendChild(label);
    timelineBlockLabels[index] = { block, label, overlapping: overlapping.has(index) };

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "timeline-block-resize";
    resizeHandle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      startTimelineResize(e, index, block);
    });
    block.appendChild(resizeHandle);

    timelineBlocks.appendChild(block);
  });
}

// 자막 블록 오른쪽(뒤쪽) 끝의 손잡이를 드래그해서 길이(끝 시각)만 조절한다.
function startTimelineResize(e, index, block) {
  e.preventDefault();
  const seg = segments[index];
  const startX = e.clientX;
  const startWidthPx = (seg.end - seg.start) * tlPxPerSecond;
  block.setPointerCapture(e.pointerId);
  block.classList.add("dragging");

  const onMove = (moveEvent) => {
    const deltaPx = moveEvent.clientX - startX;
    const newWidthPx = Math.max(tlPxPerSecond * 0.1, startWidthPx + deltaPx);
    block.style.width = `${newWidthPx}px`;
  };

  const onUp = (upEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    block.releasePointerCapture(upEvent.pointerId);
    block.classList.remove("dragging");

    const deltaPx = upEvent.clientX - startX;
    const deltaSeconds = deltaPx / tlPxPerSecond;
    const newEnd = Math.max(seg.start + 0.1, Math.min(tlVideoDuration, seg.end + deltaSeconds));
    segments[index].end = newEnd;
    renderAllSegments();
    pushHistory();
    saveSegments("자동 저장됨");
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function startTimelineDrag(e, index, block) {
  e.preventDefault();
  const seg = segments[index];
  tlDragState = { index, startX: e.clientX, startLeftPx: seg.start * tlPxPerSecond, moved: false };
  block.setPointerCapture(e.pointerId);

  const onMove = (moveEvent) => {
    if (!tlDragState) return;
    const deltaPx = moveEvent.clientX - tlDragState.startX;
    if (!tlDragState.moved && Math.abs(deltaPx) > 4) {
      tlDragState.moved = true;
      block.classList.add("dragging");
    }
    if (tlDragState.moved) {
      block.style.transform = `translateX(${deltaPx}px)`;
    }
  };

  const onUp = (upEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    block.releasePointerCapture(upEvent.pointerId);
    block.classList.remove("dragging");
    block.style.transform = "";

    if (tlDragState && tlDragState.moved) {
      const deltaPx = upEvent.clientX - tlDragState.startX;
      const deltaSeconds = deltaPx / tlPxPerSecond;
      shiftIndices([index], deltaSeconds);
    } else {
      // 드래그가 아니라 클릭 -> 그 위치로 재생 (▷ 버튼과 동일한 동작)
      player.currentTime = segments[index].start;
      player.play();
    }
    tlDragState = null;
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

// 눈금자/빈 공간 클릭 시 그 시각으로 이동 (탐색바처럼 동작)
timelineContent.addEventListener("click", (e) => {
  if (e.target.closest(".timeline-block")) return;
  const rect = timelineContent.getBoundingClientRect();
  const clickedTime = (e.clientX - rect.left) / tlPxPerSecond;
  player.currentTime = Math.max(0, Math.min(tlVideoDuration, clickedTime));
});

function updateTimelinePlayhead() {
  if (!tlVideoDuration) return;
  const leftPx = player.currentTime * tlPxPerSecond;
  timelinePlayhead.style.left = `${leftPx}px`;

  if (!player.paused && !tlDragState) {
    const viewStart = timelineScroll.scrollLeft;
    const viewEnd = viewStart + timelineScroll.clientWidth;
    if (leftPx < viewStart || leftPx > viewEnd) {
      timelineScroll.scrollLeft = leftPx - timelineScroll.clientWidth / 2;
    }
  }
}

async function requestWaveformRedraw() {
  clearTimeout(tlWaveformFetchTimer);
  tlWaveformFetchTimer = setTimeout(async () => {
    if (!jobId || !tlVideoDuration) return;
    const width = timelineScroll.clientWidth || 1;
    const start = Math.max(0, timelineScroll.scrollLeft / tlPxPerSecond);
    const end = Math.min(tlVideoDuration, start + width / tlPxPerSecond);
    const points = Math.max(1, Math.round(width));

    timelineWaveform.width = width;
    timelineWaveform.height = 40;

    const res = await fetch(`/api/videos/${jobId}/waveform?start=${start}&end=${end}&points=${points}`);
    if (!res.ok) return;
    const data = await res.json();
    drawWaveform(data.peaks || []);
  }, 150);
}

function drawWaveform(peaks) {
  const ctx = timelineWaveform.getContext("2d");
  const w = timelineWaveform.width;
  const h = timelineWaveform.height;
  ctx.clearRect(0, 0, w, h);
  if (peaks.length === 0) return;
  ctx.fillStyle = "rgba(79, 70, 229, 0.35)";
  const mid = h / 2;
  peaks.forEach((p, i) => {
    const barHeight = Math.max(1, p * mid);
    ctx.fillRect(i, mid - barHeight, 1, barHeight * 2);
  });
}

timelineScroll.addEventListener("scroll", requestWaveformRedraw);

function setTimelineZoom(px) {
  const centerTime = (timelineScroll.scrollLeft + timelineScroll.clientWidth / 2) / tlPxPerSecond;
  tlPxPerSecond = px;
  tlZoomSlider.value = px;
  if (tlVideoDuration) {
    timelineContent.style.width = `${tlVideoDuration * tlPxPerSecond}px`;
    renderTimelineRuler();
    renderTimelineBlocks();
    updateTimelinePlayhead();
    timelineScroll.scrollLeft = centerTime * tlPxPerSecond - timelineScroll.clientWidth / 2;
  }
  requestWaveformRedraw();
}

tlZoomSlider.addEventListener("input", () => setTimelineZoom(Number(tlZoomSlider.value)));
tlZoomOutBtn.addEventListener("click", () => setTimelineZoom(Math.max(5, tlPxPerSecond - 10)));
tlZoomInBtn.addEventListener("click", () => setTimelineZoom(Math.min(200, tlPxPerSecond + 10)));

function setBurnProgress(message, fraction, currentSeconds, duration) {
  burnProgressWrap.hidden = false;
  const percent = Math.round((fraction || 0) * 100);
  const timeLabel = duration ? ` (${formatHMS(currentSeconds)} / ${formatHMS(duration)})` : "";
  burnProgressMessage.textContent = message + timeLabel;
  burnProgressPercent.textContent = `${percent}%`;
  burnProgressFill.style.width = `${percent}%`;
}

burnPickBtn.addEventListener("click", async () => {
  const res = await fetch("/api/pick-file", { method: "POST" });
  if (!res.ok) return;
  const data = await res.json();
  burnSourcePathValue = data.path;
  burnSourcePath.textContent = burnSourcePathValue;
  burnBtn.disabled = false;
  cutBtn.disabled = false;
});

burnBtn.addEventListener("click", async () => {
  if (!jobId || !burnSourcePathValue) return;

  const style = currentStyleForSave();

  burnBtn.disabled = true;
  burnCancelBtn.hidden = false;
  setBurnProgress("굽기 요청 중...", 0);

  const res = await fetch(`/api/videos/${jobId}/burn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: burnSourcePathValue, style }),
  });
  if (!res.ok) {
    setBurnProgress("실패: " + (await res.text()), 0);
    burnBtn.disabled = false;
    burnCancelBtn.hidden = true;
    return;
  }

  pollBurnStatus();
});

burnCancelBtn.addEventListener("click", async () => {
  burnCancelBtn.disabled = true;
  await fetch(`/api/videos/${jobId}/burn/cancel`, { method: "POST" });
  burnCancelBtn.disabled = false;
});

async function pollBurnStatus() {
  const res = await fetch(`/api/videos/${jobId}/burn/status`);
  const data = await res.json();
  setBurnProgress(data.message || data.status, data.progress, data.current_seconds, data.duration);

  if (data.status === "done") {
    burnBtn.disabled = false;
    burnCancelBtn.hidden = true;
    setBurnProgress(`완료! 저장 위치: ${data.output_path}`, 1, data.duration, data.duration);
  } else if (data.status === "cancelled") {
    burnBtn.disabled = false;
    burnCancelBtn.hidden = true;
    setBurnProgress("중지됨", 0);
  } else if (data.status === "error") {
    burnBtn.disabled = false;
    burnCancelBtn.hidden = true;
  } else {
    setTimeout(pollBurnStatus, 1000);
  }
}

function setCutProgress(message, fraction, currentSeconds, duration) {
  cutProgressWrap.hidden = false;
  const percent = Math.round((fraction || 0) * 100);
  const timeLabel = duration ? ` (${formatHMS(currentSeconds)} / ${formatHMS(duration)})` : "";
  cutProgressMessage.textContent = message + timeLabel;
  cutProgressPercent.textContent = `${percent}%`;
  cutProgressFill.style.width = `${percent}%`;
}

function updateCutBtnLabel() {
  cutBtn.textContent = cutInvertCheckbox.checked
    ? "🔇 무음 구간만 모아서 영상 만들기 (위에서 고른 영상 사용)"
    : "✂ 무음 구간 잘라내기 (위에서 고른 영상 사용)";
}
cutInvertCheckbox.addEventListener("change", updateCutBtnLabel);

cutBtn.addEventListener("click", async () => {
  if (!jobId || !burnSourcePathValue) return;

  cutBtn.disabled = true;
  cutCancelBtn.hidden = false;
  setCutProgress("잘라내기 요청 중...", 0);

  const res = await fetch(`/api/videos/${jobId}/cut-silence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: burnSourcePathValue, invert: cutInvertCheckbox.checked }),
  });
  if (!res.ok) {
    setCutProgress("실패: " + (await res.text()), 0);
    cutBtn.disabled = false;
    cutCancelBtn.hidden = true;
    return;
  }

  pollCutStatus();
});

cutCancelBtn.addEventListener("click", async () => {
  cutCancelBtn.disabled = true;
  await fetch(`/api/videos/${jobId}/cut-silence/cancel`, { method: "POST" });
  cutCancelBtn.disabled = false;
});

async function pollCutStatus() {
  const res = await fetch(`/api/videos/${jobId}/cut-silence/status`);
  const data = await res.json();
  setCutProgress(data.message || data.status, data.progress, data.current_seconds, data.duration);

  if (data.status === "done") {
    cutBtn.disabled = false;
    cutCancelBtn.hidden = true;
    setCutProgress(`완료! 저장 위치: ${data.output_path}`, 1, data.duration, data.duration);
  } else if (data.status === "cancelled") {
    cutBtn.disabled = false;
    cutCancelBtn.hidden = true;
    setCutProgress("중지됨", 0);
  } else if (data.status === "error") {
    cutBtn.disabled = false;
    cutCancelBtn.hidden = true;
  } else {
    setTimeout(pollCutStatus, 1000);
  }
}

// --- 재생 속도 ---------------------------------------------------------------
document.querySelectorAll(".speed-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    player.playbackRate = Number(btn.dataset.speed);
    document.querySelectorAll(".speed-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// --- 스페이스바로 재생/정지, 방향키로 이전/다음 자막 이동 -----------------------
function jumpToSegment(target) {
  if (!target) return;
  player.currentTime = target.start;
  player.play();
  const rows = subtitleList.querySelectorAll(".seg-row");
  const idx = segments.indexOf(target);
  rows[idx]?.scrollIntoView({ block: "center", behavior: "smooth" });
}

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement.tagName;
  const isEditable = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement.isContentEditable;
  if (isEditable || workspace.hidden) return;

  if (e.code === "Space") {
    e.preventDefault();
    if (player.paused) player.play();
    else player.pause();
  } else if (e.code === "ArrowRight") {
    e.preventDefault();
    const next = segments.find((seg) => seg.start > player.currentTime + 0.05);
    jumpToSegment(next);
  } else if (e.code === "ArrowLeft") {
    e.preventDefault();
    const currentIdx = segments.findIndex((seg) => player.currentTime >= seg.start && player.currentTime < seg.end);
    // 지금 자막의 시작 부분에 이미 있으면 그 이전 자막으로, 자막 중간이면 지금 자막의 시작으로 이동
    let prev;
    if (currentIdx > 0 && player.currentTime - segments[currentIdx].start < 0.3) {
      prev = segments[currentIdx - 1];
    } else if (currentIdx >= 0) {
      prev = segments[currentIdx];
    } else {
      prev = [...segments].reverse().find((seg) => seg.start < player.currentTime - 0.05);
    }
    jumpToSegment(prev);
  }
});
