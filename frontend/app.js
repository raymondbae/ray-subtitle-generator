const pickFileBtn = document.getElementById("pick-file-btn");
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
const syncSelectedCountEl = document.getElementById("sync-selected-count");
const syncOffsetInput = document.getElementById("sync-offset-input");
const syncApplyBtn = document.getElementById("sync-apply-btn");
const syncClearBtn = document.getElementById("sync-clear-btn");
const currentTimeDisplay = document.getElementById("current-time-display");

let jobId = null;
let segments = [];
let pickedPath = null;
let changedIndices = [];
const selectedIndices = new Set();

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

syncApplyBtn.addEventListener("click", () => {
  const offset = Number(syncOffsetInput.value);
  if (!offset || selectedIndices.size === 0) return;
  selectedIndices.forEach((i) => {
    const seg = segments[i];
    if (!seg) return;
    seg.start = Math.max(0, seg.start + offset);
    seg.end = Math.max(seg.start + 0.1, seg.end + offset);
  });
  renderAllSegments();
  pushHistory();
  saveSegments("자동 저장됨");
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
}

// URL에 ?job=<id> 가 있으면 새로 생성하지 않고 기존 결과를 바로 불러온다.
window.addEventListener("DOMContentLoaded", async () => {
  const existingJob = new URLSearchParams(location.search).get("job");
  if (!existingJob) return;
  jobId = existingJob;
  player.src = `/api/videos/${jobId}/video`;
  downloadLink.href = `/api/videos/${jobId}/subtitles/download`;
  workspace.hidden = false;
  await syncSubtitles();
  pushHistory();
});

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
  player.src = `/api/videos/${jobId}/video`;
  downloadLink.href = `/api/videos/${jobId}/subtitles/download`;
  return jobId;
}

startBtn.addEventListener("click", async () => {
  if (!pickedPath) return;
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

  const time = document.createElement("div");
  time.className = "seg-time";
  time.textContent = `${formatTime(seg.start)} - ${formatTime(seg.end)}`;

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

  row.addEventListener("click", (e) => {
    if (e.target !== text && e.target !== deleteBtn && e.target !== checkbox) {
      player.currentTime = seg.start;
      player.play();
    }
  });

  row.appendChild(checkbox);
  row.appendChild(time);
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
});

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
function applyCaptionStyle() {
  captionOverlay.style.setProperty("--cap-size", styleSize.value);
  captionOverlay.style.setProperty("--cap-color", styleColor.value);
  captionOverlay.style.setProperty("--cap-outline", styleOutlineColor.value);
  captionOverlay.style.setProperty("--cap-margin", `${styleMargin.value}px`);
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

[styleSize, styleColor, styleOutlineColor, stylePosition, styleMargin, styleWidth].forEach((el) => {
  el.addEventListener("input", applyCaptionStyle);
  el.addEventListener("change", saveBurnStylePrefs);
});
applyCaptionStyle();

// 마지막으로 저장된 스타일을 불러와 컨트롤에 반영한다.
async function loadBurnStylePrefs() {
  try {
    const res = await fetch("/api/burn-style");
    if (!res.ok) return;
    const style = await res.json();
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
