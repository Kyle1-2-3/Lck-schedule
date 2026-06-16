import { test } from "node:test";
import assert from "node:assert/strict";
import { expandRange } from "../public/util.js";

test("expandRange widens to today ±1 when data is narrower", () => {
  const r = expandRange({ min: "2026-06", max: "2026-06" }, "2026-06");
  assert.equal(r.min, "2026-05");
  assert.equal(r.max, "2026-07");
});

test("expandRange keeps wider data bounds", () => {
  const r = expandRange({ min: "2026-01", max: "2026-12" }, "2026-06");
  assert.equal(r.min, "2026-01");
  assert.equal(r.max, "2026-12");
});

test("expandRange handles year boundaries", () => {
  const r = expandRange({ min: "2026-12", max: "2026-12" }, "2026-12");
  assert.equal(r.min, "2026-11");
  assert.equal(r.max, "2027-01");
});

test("expandRange tolerates empty/undefined range", () => {
  const r = expandRange(null, "2026-06");
  assert.equal(r.min, "2026-05");
  assert.equal(r.max, "2026-07");
});
