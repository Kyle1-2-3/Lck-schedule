import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEvent, mergeEvents, pickTargetTournament } from "../src/worker.js";

test("normalizeEvent tags league and normalizes http->https", () => {
  const ev = {
    startTime: "2026-06-27T08:00:00Z",
    state: "unstarted",
    blockName: "Play-In",
    match: {
      id: "m1",
      strategy: { count: 3 },
      teams: [
        { code: "T1", name: "T1", image: "http://x.png", result: { gameWins: 0, outcome: null } },
        { code: "GEN", name: "Gen.G", image: "http://y.png", result: { gameWins: 0, outcome: null } },
      ],
    },
  };
  const out = normalizeEvent(ev, { slug: "msi", label: "MSI" });
  assert.equal(out.league, "msi");
  assert.equal(out.leagueLabel, "MSI");
  assert.equal(out.bestOf, 3);
  assert.equal(out.teams[0].image, "https://x.png");
});

test("mergeEvents dedupes by id and sorts by startTime", () => {
  const lck = [{ id: "1", startTime: "2026-06-14T00:00:00Z", league: "lck", blockName: "" }];
  const msi = [
    { id: "1", startTime: "2026-06-14T00:00:00Z", league: "lck", blockName: "" }, // dup id
    { id: "2", startTime: "2026-06-27T00:00:00Z", league: "msi", blockName: "" },
  ];
  const out = mergeEvents([lck, msi]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "1");
  assert.equal(out[1].id, "2");
});

const TOURS = [
  { league: "lck", startDate: "2026-03-31", endDate: "2026-06-14" }, // completed
  { league: "msi", startDate: "2026-06-27", endDate: "2026-07-12" }, // upcoming
  { league: "lck", startDate: "2026-07-19", endDate: "2026-10-11" }, // upcoming
];

test("pickTargetTournament: picks latest completed when none ongoing", () => {
  const t = pickTargetTournament(TOURS, "2026-06-16T00:00:00Z");
  assert.equal(t.league, "lck");
  assert.equal(t.endDate, "2026-06-14");
});

test("pickTargetTournament: picks ongoing (latest start) once it begins", () => {
  const t = pickTargetTournament(TOURS, "2026-06-30T00:00:00Z");
  assert.equal(t.league, "msi");
});

test("pickTargetTournament: null when no tournaments", () => {
  assert.equal(pickTargetTournament([], "2026-06-16T00:00:00Z"), null);
});
