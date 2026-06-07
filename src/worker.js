// LCK · Vancouver — Cloudflare Worker
// Serves the static site (via the ASSETS binding) and proxies two data sources:
//   GET /api/schedule  -> lolesports (rich match list, logos, live state)
//   GET /api/bracket   -> Leaguepedia Cargo (real playoff bracket tree)
// Same origin for both, so the browser never deals with CORS or the API key.

const LOL_BASE = "https://esports-api.lolesports.com/persisted/gw";
const LOL_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"; // long-standing public watch.lolesports.com key
const LCK_LEAGUE_ID = "98767991310872058";

const LP_BASE = "https://lol.fandom.com/api.php";
const LP_UA = "LCK-Vancouver/1.0 (personal schedule site; bridge11korea@gmail.com)";

// Cache TTLs (seconds). lolesports is CloudFront-cached and cheap; Leaguepedia rate-limits hard.
const SCHEDULE_TTL = 120;
const BRACKET_TTL = 1800;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/schedule") {
      return withCache(request, ctx, SCHEDULE_TTL, () => getSchedule());
    }
    if (url.pathname === "/api/bracket") {
      return withCache(request, ctx, BRACKET_TTL, () => getBracket());
    }
    if (url.pathname === "/api/health") {
      return json({ ok: true, endpoints: ["/api/schedule", "/api/bracket"] });
    }

    // Everything else -> static assets (index.html, styles.css, *.js).
    return env.ASSETS.fetch(request);
  },
};

// --- response helpers --------------------------------------------------------

function json(obj, ttl) {
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (ttl) headers["cache-control"] = `public, max-age=${ttl}`;
  return new Response(JSON.stringify(obj), { headers });
}

// Edge-cache successful results; on upstream failure, fall back to a stale cached
// copy if one exists (important for Leaguepedia's aggressive rate limiting).
async function withCache(request, ctx, ttl, producer) {
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const data = await producer();
    const res = json({ ...data, updatedAt: new Date().toISOString() }, ttl);
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 0);
  }
}

// --- schedule (lolesports) ---------------------------------------------------

async function lolFetch(path) {
  const res = await fetch(`${LOL_BASE}/${path}`, {
    headers: { "x-api-key": LOL_KEY },
  });
  if (!res.ok) throw new Error(`lolesports ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function getSchedule() {
  // The default page is the latest ~80 events; walk a few "older" pages back so
  // the month navigator has recent history + upcoming games to browse.
  const seen = new Set();
  const events = [];
  let token = null;

  for (let i = 0; i < 4; i++) {
    const q = `getSchedule?hl=ko-KR&leagueId=${LCK_LEAGUE_ID}` +
      (token ? `&pageToken=${encodeURIComponent(token)}` : "");
    const data = await lolFetch(q);
    const sched = data?.data?.schedule;
    const page = sched?.events || [];
    for (const ev of page) {
      const id = ev?.match?.id || `${ev.startTime}-${ev.blockName}`;
      if (seen.has(id)) continue;
      seen.add(id);
      events.push(normalizeEvent(ev));
    }
    token = sched?.pages?.older || null;
    if (!token) break;
  }

  events.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return { events };
}

function normalizeEvent(ev) {
  const m = ev.match || {};
  const teams = (m.teams || []).map((t) => ({
    code: t.code || "TBD",
    name: t.name || "TBD",
    image: (t.image || "").replace(/^http:/, "https:"),
    gameWins: t.result?.gameWins ?? null,
    outcome: t.result?.outcome ?? null, // "win" | "loss" | null
  }));
  return {
    id: m.id || null,
    startTime: ev.startTime,
    state: ev.state, // unstarted | inProgress | completed
    blockName: ev.blockName || "",
    bestOf: m.strategy?.count ?? null,
    teams,
  };
}

// --- bracket (Leaguepedia Cargo) ---------------------------------------------

async function lpCargo(params) {
  const qs = new URLSearchParams({
    action: "cargoquery",
    format: "json",
    origin: "*",
    ...params,
  });
  const res = await fetch(`${LP_BASE}?${qs}`, { headers: { "User-Agent": LP_UA } });
  if (!res.ok) throw new Error(`Leaguepedia HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Leaguepedia: ${data.error.code}`);
  return (data.cargoquery || []).map((r) => r.title);
}

// Tabs that represent a knockout/bracket round (vs. regular "Week N" tabs).
const BRACKET_TAB_OR =
  '(MatchSchedule.Tab LIKE "%Playoff%" OR MatchSchedule.Tab LIKE "%Knockout%"' +
  ' OR MatchSchedule.Tab LIKE "%Gauntlet%" OR MatchSchedule.Tab LIKE "%Final%"' +
  ' OR MatchSchedule.Tab LIKE "%Play-In%" OR MatchSchedule.Tab LIKE "%Bracket%")';

// Leaguepedia rate-limits hard, so the bracket is built from a SINGLE query:
// grab every bracket-tab match for the league-year, then keep only the most
// recent tournament page's rows. (Falls back to the previous year once if the
// current year has no bracket yet.)
async function getBracket() {
  const year = new Date().getFullYear();

  let rows = await bracketRows(year);
  let usedYear = year;
  if (!rows.length) {
    rows = await bracketRows(year - 1);
    usedYear = year - 1;
  }
  if (!rows.length) {
    return { available: false, tournament: `LCK ${year}`, rounds: [] };
  }

  // Pick the most recently-played tournament page among the results.
  const latestByPage = new Map();
  for (const r of rows) {
    const page = r.OverviewPage || "";
    const dt = r["DateTime UTC"] || r.DateTime_UTC || "";
    if (!latestByPage.has(page) || dt > latestByPage.get(page)) latestByPage.set(page, dt);
  }
  let chosenPage = "", chosenDt = "";
  for (const [page, dt] of latestByPage) {
    if (dt > chosenDt) { chosenDt = dt; chosenPage = page; }
  }

  const pageRows = rows.filter((r) => (r.OverviewPage || "") === chosenPage);
  const rounds = buildRounds(pageRows);
  const todayISO = new Date().toISOString().slice(0, 10);

  return {
    available: rounds.length > 0,
    tournament: prettyTournament(null, chosenPage),
    ongoing: chosenDt.slice(0, 10) >= todayISO,
    rounds,
  };
}

function bracketRows(year) {
  return lpCargo({
    tables: "MatchSchedule",
    fields:
      "OverviewPage,Team1,Team2,Team1Score,Team2Score,Winner,Tab,N_TabInPage,N_MatchInTab,BestOf,DateTime_UTC,MatchId",
    where: `MatchSchedule.OverviewPage LIKE "LCK/${year}%" AND ${BRACKET_TAB_OR}`,
    order_by: "MatchSchedule.N_TabInPage,MatchSchedule.N_MatchInTab",
    limit: "200",
  });
}

function buildRounds(rows) {
  const byTab = new Map();
  for (const r of rows) {
    // Cargo returns multi-word field keys with spaces, not underscores.
    const tab = r.Tab || r["Tab"] || "";
    if (!tab) continue;
    const order = parseInt(r["N TabInPage"] ?? r.N_TabInPage ?? "0", 10) || 0;
    if (!byTab.has(tab)) byTab.set(tab, { name: tab, order, matches: [] });
    byTab.get(tab).matches.push(normalizeBracketMatch(r));
  }
  const rounds = [...byTab.values()];
  rounds.forEach((rd) =>
    rd.matches.sort((a, b) => a.pos - b.pos || a.startTime.localeCompare(b.startTime))
  );
  rounds.sort((a, b) => a.order - b.order);
  return rounds;
}

function normalizeBracketMatch(r) {
  const dt = (r["DateTime UTC"] || r.DateTime_UTC || "").replace(" ", "T");
  const startTime = dt ? `${dt}Z` : "";
  const s1 = r.Team1Score, s2 = r.Team2Score;
  return {
    team1: r.Team1 || "TBD",
    team2: r.Team2 || "TBD",
    score1: s1 === "" || s1 == null ? null : Number(s1),
    score2: s2 === "" || s2 == null ? null : Number(s2),
    winner: r.Winner === "1" ? 1 : r.Winner === "2" ? 2 : null,
    bestOf: r.BestOf ? Number(r.BestOf) : null,
    startTime,
    pos: parseInt(r["N MatchInTab"] ?? r.N_MatchInTab ?? "0", 10) || 0,
  };
}

function prettyTournament(name, page) {
  if (name) return name;
  if (page) return page.replace(/^LCK\//, "LCK ").replace(/\//g, " · ");
  return "LCK";
}
