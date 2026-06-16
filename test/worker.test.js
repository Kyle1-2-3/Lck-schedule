import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEvent, mergeEvents } from "../src/worker.js";

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
