import { fmtShortDate } from "./util.js";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function teamLine(name, logo, score, isWinner, isLoser) {
  const row = el("div", "bm__team");
  if (isWinner) row.classList.add("is-winner");
  if (isLoser) row.classList.add("is-loser");

  const left = el("span", "bm__name");
  if (logo) {
    const img = document.createElement("img");
    img.className = "bm__logo";
    img.src = logo;
    img.alt = name || "";
    img.loading = "lazy";
    img.onerror = () => { img.style.visibility = "hidden"; };
    left.append(img);
  }
  left.append(el("span", null, name || "TBD"));

  row.append(left);
  row.append(el("span", "bm__score", score == null ? "" : String(score)));
  return row;
}

function matchBox(m) {
  const box = el("div", "bracket__match");
  box.append(
    teamLine(m.team1, m.logo1, m.score1, m.winner === 1, m.winner === 2),
    teamLine(m.team2, m.logo2, m.score2, m.winner === 2, m.winner === 1)
  );
  const meta = [];
  if (m.bestOf) meta.push(`BO${m.bestOf}`);
  if (m.startTime) meta.push(fmtShortDate(m.startTime));
  if (meta.length) box.append(el("div", "bm__meta", meta.join(" · ")));
  return box;
}

export function renderBracket(data, container) {
  container.innerHTML = "";

  if (!data || !data.available) {
    const wrap = el("div", "bracket-empty");
    wrap.append(el("div", null, "아직 대진표가 공개되지 않았어요."));
    if (data && data.tournament) {
      wrap.append(el("div", "updated", `${data.tournament} · 플레이오프가 시작되면 자동으로 표시됩니다`));
    }
    container.append(wrap);
    return;
  }

  const head = el("div", "day-group__date");
  head.textContent = data.ongoing ? `${data.tournament} (진행 중)` : data.tournament;
  container.append(head);

  const scroller = el("div", "bracket-wrap");
  const bracket = el("div", "bracket");
  for (const round of data.rounds) {
    const col = el("div", "bracket__round");
    col.append(el("div", "bracket__round-title", round.name));
    for (const m of round.matches) col.append(matchBox(m));
    bracket.append(col);
  }
  scroller.append(bracket);
  container.append(scroller);
}
