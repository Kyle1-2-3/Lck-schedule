// Time helpers — everything is rendered in Vancouver local time.
export const TZ = "America/Vancouver";

const WK = { Sun: "일", Mon: "월", Tue: "화", Wed: "수", Thu: "목", Fri: "금", Sat: "토" };

function parts(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const o = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

export function dateKey(iso) {
  const o = parts(iso);
  return `${o.year}-${o.month}-${o.day}`;
}

export function monthKey(iso) {
  const o = parts(iso);
  return `${o.year}-${o.month}`;
}

export function fmtTime(iso) {
  const o = parts(iso);
  return `${o.hour}:${o.minute}`;
}

export function fmtDayHeading(iso) {
  const o = parts(iso);
  return `${Number(o.month)}월 ${Number(o.day)}일 (${WK[o.weekday] || ""})`;
}

export function fmtMonthLabel(key) {
  const [y, m] = key.split("-");
  return `${y}년 ${Number(m)}월`;
}

export function fmtShortDate(iso) {
  if (!iso) return "";
  const o = parts(iso);
  return `${Number(o.month)}/${Number(o.day)}`;
}

export function todayMonthKey() {
  return monthKey(new Date());
}

// "YYYY-MM" arithmetic, used by the month navigator.
export function stepMonth(key, delta) {
  let [y, m] = key.split("-").map(Number);
  m += delta;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function clampMonth(key, min, max) {
  if (key < min) return min;
  if (key > max) return max;
  return key;
}
