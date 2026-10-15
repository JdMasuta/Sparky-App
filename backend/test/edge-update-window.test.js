import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWindow,
  assertTimeZone,
  localMinutes,
  isOpen,
  nextOpen,
  describeWindow,
} from "../../deploy/edge/update-window.mjs";

const W = parseWindow("17:00-03:00");
const CHI = "America/Chicago";
// 2026-10-15 is CDT (UTC-5).
const chi = (hhmm, day = "2026-10-15") => new Date(`${day}T${hhmm}:00-05:00`);

test("parseWindow", () => {
  assert.deepEqual(parseWindow("17:00-03:00"), { start: 1020, end: 180, spec: "17:00-03:00" });
  assert.deepEqual(parseWindow(" 09:30 - 11:15 "), { start: 570, end: 675, spec: "09:30-11:15" });
  for (const bad of ["", "17-03", "25:00-03:00", "17:00-17:00", "17:00-03:00-04:00", "5pm-3am"]) {
    assert.throws(() => parseWindow(bad), /Invalid update window/, bad);
  }
});

test("assertTimeZone rejects unknown zones", () => {
  assert.equal(assertTimeZone(CHI), CHI);
  assert.throws(() => assertTimeZone("Mars/Olympus"));
});

test("localMinutes uses the device time zone, not UTC", () => {
  assert.equal(localMinutes(chi("17:30"), CHI), 17 * 60 + 30);
  assert.equal(localMinutes(chi("17:30"), "UTC"), 22 * 60 + 30);
});

test("midnight-crossing window: open 17:00 (inclusive) to 03:00 (exclusive)", () => {
  assert.equal(isOpen(chi("16:59"), W, CHI), false);
  assert.equal(isOpen(chi("17:00"), W, CHI), true);
  assert.equal(isOpen(chi("23:59"), W, CHI), true);
  assert.equal(isOpen(chi("00:00", "2026-10-16"), W, CHI), true);
  assert.equal(isOpen(chi("02:59", "2026-10-16"), W, CHI), true);
  assert.equal(isOpen(chi("03:00", "2026-10-16"), W, CHI), false);
  assert.equal(isOpen(chi("12:00"), W, CHI), false);
});

test("same-day window", () => {
  const day = parseWindow("09:00-11:00");
  assert.equal(isOpen(chi("08:59"), day, CHI), false);
  assert.equal(isOpen(chi("09:00"), day, CHI), true);
  assert.equal(isOpen(chi("11:00"), day, CHI), false);
});

test("nextOpen returns now when open, else the next window start", () => {
  const inside = chi("20:15");
  assert.equal(nextOpen(inside, W, CHI).getTime(), inside.getTime());
  assert.equal(nextOpen(chi("14:00"), W, CHI).toISOString(), chi("17:00").toISOString());
  // Just after close: the same day's 17:00.
  assert.equal(nextOpen(chi("03:00", "2026-10-16"), W, CHI).toISOString(), chi("17:00", "2026-10-16").toISOString());
  // Mid-minute input still lands on the exact minute boundary.
  assert.equal(nextOpen(new Date(chi("16:59").getTime() + 30_000), W, CHI).toISOString(), chi("17:00").toISOString());
});

test("DST spring-forward: the window still closes at local 03:00", () => {
  // 2026-03-08 02:00 CST jumps to 03:00 CDT. 01:59 CST (07:59Z) is open; 03:00 CDT (08:00Z) is closed.
  assert.equal(isOpen(new Date("2026-03-08T07:59:00Z"), W, CHI), true);
  assert.equal(isOpen(new Date("2026-03-08T08:00:00Z"), W, CHI), false);
  // Next opening is 17:00 CDT = 22:00Z.
  assert.equal(nextOpen(new Date("2026-03-08T08:00:00Z"), W, CHI).toISOString(), "2026-03-08T22:00:00.000Z");
});

test("DST fall-back: the repeated 01:xx hour is open both times", () => {
  // 2026-11-01 01:30 CDT (06:30Z) and 01:30 CST (07:30Z).
  assert.equal(isOpen(new Date("2026-11-01T06:30:00Z"), W, CHI), true);
  assert.equal(isOpen(new Date("2026-11-01T07:30:00Z"), W, CHI), true);
  // 03:00 CST = 09:00Z closes it.
  assert.equal(isOpen(new Date("2026-11-01T09:00:00Z"), W, CHI), false);
  assert.equal(nextOpen(new Date("2026-11-01T09:00:00Z"), W, CHI).toISOString(), "2026-11-01T23:00:00.000Z");
});

test("describeWindow", () => {
  assert.deepEqual(describeWindow(chi("14:00"), W, CHI), {
    spec: "17:00-03:00",
    tz: CHI,
    open: false,
    nextOpen: chi("17:00").toISOString(),
  });
});
