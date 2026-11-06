// Unit tests for the money + billing-cycle helpers.  Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPaise, parseAmount, splitEqually, sumPaise, toPaise, toRupees } from "../src/lib/money.ts";
import { currentCycle } from "../src/lib/dates.ts";

test("₹100 split three ways adds up to exactly ₹100", () => {
  const shares = splitEqually(10000, ["a", "b", "c"]);
  assert.deepEqual([...shares.values()], [3334, 3333, 3333]);
  assert.equal([...shares.values()].reduce((s, v) => s + v, 0), 10000);
});

test("equal split of ₹6,000 between three friends", () => {
  assert.deepEqual([...splitEqually(600000, ["heet", "amit", "rahul"]).values()], [200000, 200000, 200000]);
});

test("split with nobody selected is empty", () => {
  assert.equal(splitEqually(1000, []).size, 0);
});

test("parseAmount understands what people type", () => {
  assert.equal(parseAmount("5000"), 500000);
  assert.equal(parseAmount("1,250.5"), 125050);
  assert.equal(parseAmount("₹ 99.99"), 9999);
  assert.equal(parseAmount("0.1"), 10);
  assert.equal(parseAmount("10.005"), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(""), null);
});

test("paise ↔ rupees conversions avoid floating point drift", () => {
  assert.equal(toPaise(33.33), 3333);
  assert.equal(toPaise("1966.66"), 196666);
  assert.equal(toRupees(3334), 33.34);
  assert.equal(sumPaise([33.34, 33.33, 33.33]), 10000);
  assert.equal(sumPaise([0.1, 0.2]), 30);
});

test("formatPaise uses Indian grouping", () => {
  assert.equal(formatPaise(10000000), "₹1,00,000");
  assert.equal(formatPaise(500000), "₹5,000");
  assert.equal(formatPaise(3333), "₹33.33");
  assert.equal(formatPaise(-3333), "-₹33.33");
});

test("billing cycle after the statement day", () => {
  // statement on 15th, due on 5th; today 20 Nov 2026
  assert.deepEqual(currentCycle(15, 5, new Date(2026, 10, 20)), { start: "2026-11-16", end: "2026-12-15", due: "2027-01-05" });
});

test("billing cycle on/before the statement day", () => {
  assert.deepEqual(currentCycle(15, 5, new Date(2026, 10, 15)), { start: "2026-10-16", end: "2026-11-15", due: "2026-12-05" });
  assert.deepEqual(currentCycle(15, 25, new Date(2026, 10, 6)), { start: "2026-10-16", end: "2026-11-15", due: "2026-11-25" });
});

test("billing day 31 is clamped in short months", () => {
  assert.deepEqual(currentCycle(31, null, new Date(2026, 10, 6)), { start: "2026-11-01", end: "2026-11-30", due: null });
  assert.deepEqual(currentCycle(31, null, new Date(2027, 1, 10)), { start: "2027-02-01", end: "2027-02-28", due: null });
});

test("no billing day → calendar month", () => {
  assert.deepEqual(currentCycle(null, null, new Date(2026, 10, 6)), { start: "2026-11-01", end: "2026-11-30", due: null });
});
