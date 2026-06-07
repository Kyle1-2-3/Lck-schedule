import { renderSchedule, monthRange } from "./schedule.js";
import { renderBracket } from "./bracket.js";
import { todayMonthKey, stepMonth, clampMonth, fmtMonthLabel, getTZ, setTZ } from "./util.js";

const $ = (id) => document.getElementById(id);

const els = {
  tabs: document.querySelectorAll(".pill-tab"),
  views: { schedule: $("view-schedule"), bracket: $("view-bracket") },
  scheduleBody: $("schedule-body"),
  bracketBody: $("bracket-body"),
  monthLabel: $("month-label"),
  prev: $("prev-month"),
  next: $("next-month"),
  region: $("region"),
};

const store = {
  events: null,
  range: null,
  month: null,
  bracketData: null,
  bracketLoaded: false,
};

// Only two regions: Vancouver and Korea.
const REGION_TZS = ["America/Vancouver", "Asia/Seoul"];

function loading(container, msg) {
  container.innerHTML = `<div class="loading"><span class="spinner"></span>${msg || "불러오는 중…"}</div>`;
}

function errorBox(container, onRetry) {
  container.innerHTML = "";
  const box = document.createElement("div");
  box.className = "error";
  box.textContent = "데이터를 불러오지 못했어요.";
  const btn = document.createElement("button");
  btn.className = "retry-btn";
  btn.textContent = "다시 시도";
  btn.onclick = onRetry;
  box.append(document.createElement("br"), btn);
  container.append(box);
}

async function getJSON(url) {
  // Bypass the browser HTTP cache so a reload always reflects the live edge data
  // (the Worker still serves its own short-lived edge cache, so this stays fast).
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// --- schedule ---------------------------------------------------------------

function paintMonth() {
  els.monthLabel.textContent = fmtMonthLabel(store.month);
  els.prev.disabled = store.month <= store.range.min;
  els.next.disabled = store.month >= store.range.max;
  renderSchedule(store.events, store.month, els.scheduleBody);
}

async function loadSchedule() {
  loading(els.scheduleBody);
  try {
    const data = await getJSON("/api/schedule");
    store.events = data.events || [];
    if (!store.events.length) {
      els.scheduleBody.innerHTML = `<div class="empty">표시할 경기가 없어요.</div>`;
      return;
    }
    store.range = monthRange(store.events);
    store.month = clampMonth(todayMonthKey(), store.range.min, store.range.max);
    paintMonth();
  } catch (e) {
    errorBox(els.scheduleBody, loadSchedule);
  }
}

els.prev.onclick = () => {
  store.month = clampMonth(stepMonth(store.month, -1), store.range.min, store.range.max);
  paintMonth();
};
els.next.onclick = () => {
  store.month = clampMonth(stepMonth(store.month, 1), store.range.min, store.range.max);
  paintMonth();
};

// --- bracket ----------------------------------------------------------------

async function loadBracket() {
  loading(els.bracketBody);
  try {
    const data = await getJSON("/api/bracket");
    store.bracketData = data;
    renderBracket(data, els.bracketBody);
    store.bracketLoaded = true;
  } catch (e) {
    errorBox(els.bracketBody, loadBracket);
  }
}

// --- region / timezone ------------------------------------------------------

function initRegion() {
  // Default to Vancouver unless Korea was previously chosen.
  if (!REGION_TZS.includes(getTZ())) setTZ("America/Vancouver");

  const btns = els.region.querySelectorAll(".region__btn");
  const paint = () =>
    btns.forEach((b) => b.classList.toggle("is-active", b.dataset.tz === getTZ()));
  btns.forEach((b) => {
    b.onclick = () => {
      setTZ(b.dataset.tz);
      paint();
      onTZChange();
    };
  });
  paint();
}

// Re-render everything already loaded in the newly selected timezone.
function onTZChange() {
  if (store.events) {
    store.range = monthRange(store.events);
    store.month = clampMonth(store.month, store.range.min, store.range.max);
    paintMonth();
  }
  if (store.bracketData) renderBracket(store.bracketData, els.bracketBody);
}

// --- tabs -------------------------------------------------------------------

function switchTab(name) {
  els.tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
  els.views.schedule.hidden = name !== "schedule";
  els.views.bracket.hidden = name !== "bracket";
  if (name === "bracket" && !store.bracketLoaded) loadBracket();
}

els.tabs.forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));

// --- boot -------------------------------------------------------------------

initRegion();
loadSchedule();
