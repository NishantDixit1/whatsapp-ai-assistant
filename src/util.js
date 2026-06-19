// ============================================================================
// SHARED TIME HELPERS  -  appointment times are stored as naive wall-clock
// strings ("YYYY-MM-DDThh:mm:ss") in the business timezone. These helpers keep
// that consistent across calendar, confirmations, and reminders.
// ============================================================================

// Strip any trailing "Z" or "+05:30" offset -> plain wall-clock string.
export function toNaive(iso) {
  return String(iso).replace(/(Z|[+-]\d{2}:\d{2})$/, "");
}

// Add minutes to a naive "YYYY-MM-DDThh:mm:ss" string, returning the same shape.
export function addMinutes(naiveIso, minutes) {
  const d = new Date(toNaive(naiveIso) + "Z"); // interpret as UTC for arithmetic
  const e = new Date(d.getTime() + minutes * 60000);
  return e.toISOString().slice(0, 19);
}

// Milliseconds for a naive wall-clock string (interpreted as UTC). Use only to
// compare against nowNaiveInTz() in the SAME timezone, so the offset cancels.
export function naiveMs(naiveIso) {
  return Date.parse(toNaive(naiveIso) + "Z");
}

// Current time as a naive "YYYY-MM-DDThh:mm:ss" wall-clock string in `tz`.
export function nowNaiveInTz(tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date());
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  const hour = m.hour === "24" ? "00" : m.hour; // some envs emit "24" at midnight
  return `${m.year}-${m.month}-${m.day}T${hour}:${m.minute}:${m.second}`;
}

function hhmmToMin(s) {
  const [h, m] = String(s).split(":").map(Number);
  return h * 60 + (m || 0);
}

// Validate a requested appointment slot against business hours, and reject
// times in the past. Returns { ok: true } or { ok: false, reason: "..." }.
export function validateSlot(naiveIso, hours, durationMinutes, tz) {
  const start = toNaive(naiveIso);
  const [d, t] = start.split("T");
  const [y, mo, day] = d.split("-").map(Number);
  const [h, mi] = (t || "00:00").split(":").map(Number);

  // Reject past times.
  if (naiveMs(start) <= naiveMs(nowNaiveInTz(tz))) {
    return { ok: false, reason: "that time is in the past" };
  }

  const dow = new Date(Date.UTC(y, mo - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  const today = hours[dow];
  if (!today) return { ok: false, reason: "we're closed that day" };

  const startMin = h * 60 + mi;
  const endMin = startMin + (durationMinutes || 30);
  if (startMin < hhmmToMin(today.open) || endMin > hhmmToMin(today.close)) {
    return { ok: false, reason: "that's outside our opening hours" };
  }
  return { ok: true };
}

// Format a naive string as friendly text, e.g. "Tuesday, June 23 at 3:00 PM".
// Built and formatted in UTC so the wall-clock time is preserved (no shift).
export function friendlyTime(iso) {
  try {
    const [d, t] = toNaive(iso).split("T");
    const [y, mo, day] = d.split("-").map(Number);
    const [h, mi] = (t || "00:00").split(":").map(Number);
    const date = new Date(Date.UTC(y, mo - 1, day, h, mi || 0));
    return date.toLocaleString("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
