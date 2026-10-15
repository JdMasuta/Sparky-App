// Update window (#25): updates execute only inside a daily local-time window,
// default 17:00–03:00 device time. Pure functions over (Date, window, IANA tz);
// DST-safe because local time is always derived through Intl, never by
// adding fixed offsets.

const formatters = new Map();
function formatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(
      tz,
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    );
  }
  return formatters.get(tz);
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "17:00-03:00" -> { start: 1020, end: 180, spec } (minutes after local midnight). */
export function parseWindow(spec) {
  const [a, b, extra] = String(spec || "").split("-");
  const ma = HHMM.exec((a || "").trim());
  const mb = HHMM.exec((b || "").trim());
  if (!ma || !mb || extra !== undefined) throw new Error(`Invalid update window "${spec}" (expected HH:MM-HH:MM)`);
  const start = Number(ma[1]) * 60 + Number(ma[2]);
  const end = Number(mb[1]) * 60 + Number(mb[2]);
  if (start === end) throw new Error(`Invalid update window "${spec}" (start equals end)`);
  return { start, end, spec: `${ma[0]}-${mb[0]}` };
}

/** Throws on an unknown IANA zone. */
export function assertTimeZone(tz) {
  formatter(tz);
  return tz;
}

/** Minutes after local midnight in `tz` for `date`. */
export function localMinutes(date, tz) {
  let hour = 0;
  let minute = 0;
  for (const part of formatter(tz).formatToParts(date)) {
    if (part.type === "hour") hour = Number(part.value);
    else if (part.type === "minute") minute = Number(part.value);
  }
  return hour * 60 + minute;
}

/** True when `date` falls inside the window (start inclusive, end exclusive). */
export function isOpen(date, win, tz) {
  const m = localMinutes(date, tz);
  return win.start < win.end ? m >= win.start && m < win.end : m >= win.start || m < win.end;
}

const MINUTE = 60_000;

/**
 * Earliest instant >= `date` at which the window is open. Walks forward in
 * whole minutes so DST transitions are handled by Intl, not by arithmetic.
 */
export function nextOpen(date, win, tz) {
  if (isOpen(date, win, tz)) return new Date(date.getTime());
  let t = Math.floor(date.getTime() / MINUTE) * MINUTE + MINUTE;
  for (let i = 0; i < 26 * 60; i++, t += MINUTE) {
    if (isOpen(new Date(t), win, tz)) return new Date(t);
  }
  throw new Error("Update window never opens"); // unreachable for a valid window
}

/** Status payload for the UI. */
export function describeWindow(date, win, tz) {
  return { spec: win.spec, tz, open: isOpen(date, win, tz), nextOpen: nextOpen(date, win, tz).toISOString() };
}
