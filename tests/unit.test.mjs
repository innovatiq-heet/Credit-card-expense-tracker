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

// ---- Supabase settings: forgive copy-paste mistakes, refuse secret keys ----
import { cleanSupabaseUrl, readSupabaseConfig } from "../src/lib/env.ts";

const URL_OK = "https://fxnqaldvwdbpsnkgagnj.supabase.co";
const KEY_OK = "sb_publishable_4BYmT2ni-DNuJo_-hFO-FQ_A2QxNA4F";

test("Supabase URL is cleaned from common paste mistakes", () => {
  for (const raw of [
    URL_OK,
    ` ${URL_OK}\n`,
    `"${URL_OK}"`,
    `'${URL_OK}'`,
    `NEXT_PUBLIC_SUPABASE_URL=${URL_OK}`,
    `${URL_OK}/rest/v1/`,
    `${URL_OK}/`,
    `${URL_OK} NEXT_PUBLIC_SUPABASE_ANON_KEY=${KEY_OK}`,
    "fxnqaldvwdbpsnkgagnj.supabase.co",
  ]) {
    assert.equal(cleanSupabaseUrl(raw), URL_OK, JSON.stringify(raw));
  }
  assert.equal(cleanSupabaseUrl("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
  assert.equal(cleanSupabaseUrl("not a url"), null);
  assert.equal(cleanSupabaseUrl(""), null);
});

test("the exact broken Netlify values now work", () => {
  // Both lines pasted into the URL variable:
  assert.deepEqual(readSupabaseConfig(`${URL_OK} NEXT_PUBLIC_SUPABASE_ANON_KEY=${KEY_OK}`, KEY_OK), { url: URL_OK, key: KEY_OK, problem: null });
  // ...even if the key variable was left empty:
  assert.deepEqual(readSupabaseConfig(`${URL_OK} NEXT_PUBLIC_SUPABASE_ANON_KEY=${KEY_OK}`, ""), { url: URL_OK, key: KEY_OK, problem: null });
  // Quoted values / NAME= prefixes:
  assert.deepEqual(readSupabaseConfig(`"${URL_OK}"`, `NEXT_PUBLIC_SUPABASE_ANON_KEY="${KEY_OK}"`), { url: URL_OK, key: KEY_OK, problem: null });
});

test("unusable settings give a clear message instead of crashing", () => {
  assert.match(readSupabaseConfig(undefined, undefined).problem, /not set/);
  assert.match(readSupabaseConfig("my project", KEY_OK).problem, /NEXT_PUBLIC_SUPABASE_URL is not a valid address/);
  assert.match(readSupabaseConfig(URL_OK, "").problem, /ANON_KEY is missing/);
  assert.match(readSupabaseConfig(URL_OK, "sb_secret_abc123").problem, /SECRET key/);
  const serviceRole = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.sig`;
  assert.match(readSupabaseConfig(URL_OK, serviceRole).problem, /service_role/);
  const anon = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.sig`;
  assert.equal(readSupabaseConfig(URL_OK, anon).problem, null);
});

test("a key in an unfamiliar format is used as typed, not refused", () => {
  assert.deepEqual(readSupabaseConfig(URL_OK, "some-future-key"), { url: URL_OK, key: "some-future-key", problem: null });
  assert.deepEqual(readSupabaseConfig(URL_OK, ' NEXT_PUBLIC_SUPABASE_ANON_KEY="some-future-key" '), {
    url: URL_OK,
    key: "some-future-key",
    problem: null,
  });
});
