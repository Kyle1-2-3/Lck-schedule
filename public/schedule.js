import { dateKey, monthKey, fmtTime, fmtDayHeading } from "./util.js";

const STATE_BADGE = {
  completed: { cls: "badge--done", label: "종료" },
  inProgress: { cls: "badge--live", label: "LIVE", live: true },
  unstarted: { cls: "badge--upcoming", label: "예정" },
};

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function teamRow(t) {
  const row = el("div", "team");
  if (t.outcome === "win") row.classList.add("is-winner");
  if (t.outcome === "loss") row.classList.add("is-loser");

  const logo = el("img", "team__logo");
  logo.src = t.image || "";
  logo.alt = t.code;
  logo.loading = "lazy";
  logo.onerror = () => { logo.style.visibility = "hidden"; };

  const code = el("span", "team__code", t.code);
  const name = el("span", "team__name", t.name);
  const score = el("span", "team__score", t.gameWins == null ? "" : String(t.gameWins));

  row.append(logo, code, name, score);
  return row;
}

function matchCard(ev) {
  const card = el("div", "match-card");
  const badge = STATE_BADGE[ev.state] || STATE_BADGE.unstarted;
  if (badge.live) card.classList.add("is-live");

  const time = el("div", "match-card__time");
  time.append(el("div", null, fmtTime(ev.startTime)));
  if (ev.bestOf) time.append(el("div", "team__name", `BO${ev.bestOf}`));

  const teams = el("div", "match-card__teams");
  for (const t of ev.teams) teams.append(teamRow(t));

  const status = el("div", "match-card__status");
  const b = el("span", `badge ${badge.cls}`);
  if (badge.live) b.append(el("span", "dot"));
  b.append(document.createTextNode(badge.label));
  status.append(b);

  card.append(time, teams, status);
  return card;
}

// Render the matches for one "YYYY-MM" month into the container.
export function renderSchedule(events, mKey, container) {
  container.innerHTML = "";
  const monthly = events.filter((e) => monthKey(e.startTime) === mKey);

  if (!monthly.length) {
    container.append(el("div", "empty", "이 달에는 LCK 경기가 없어요."));
    return;
  }

  // group by Vancouver calendar day
  const byDay = new Map();
  for (const e of monthly) {
    const k = dateKey(e.startTime);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }

  for (const day of [...byDay.keys()].sort()) {
    const group = el("div", "day-group");
    group.append(el("div", "day-group__date", fmtDayHeading(byDay.get(day)[0].startTime)));
    for (const ev of byDay.get(day)) group.append(matchCard(ev));
    container.append(group);
  }
}

// Distinct months present in the data, sorted ascending.
export function monthRange(events) {
  const keys = [...new Set(events.map((e) => monthKey(e.startTime)))].sort();
  return { min: keys[0], max: keys[keys.length - 1] };
}
