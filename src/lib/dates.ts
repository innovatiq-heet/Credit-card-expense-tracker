// Dates in the database are plain calendar dates ("2026-11-05").

const pad = (n: number) => String(n).padStart(2, "0");

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

function fromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(iso: string, withYear = false): string {
  return fromISO(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** Local calendar day of a timestamp: "5 Nov". */
export function formatDay(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7); // "2026-11"
}

export function formatMonth(key: string): string {
  return fromISO(`${key}-01`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function timeAgo(timestamp: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** A day of the month, clamped to the month's length (31 → 30 in November). */
function dayInMonth(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

export type BillingCycle = {
  start: string; // first day of the cycle (inclusive)
  end: string; // statement date (inclusive)
  due: string | null; // payment due date
};

/**
 * The credit card cycle that contains `today`.
 * Without a billing day, the calendar month is used.
 */
export function currentCycle(billingDay: number | null, dueDay: number | null, today = new Date()): BillingCycle {
  const y = today.getFullYear();
  const m = today.getMonth();
  let start: Date;
  let end: Date;

  if (!billingDay) {
    start = new Date(y, m, 1);
    end = new Date(y, m + 1, 0);
  } else {
    const statementThisMonth = dayInMonth(y, m, billingDay);
    if (today.getDate() > statementThisMonth.getDate()) {
      start = new Date(y, m, statementThisMonth.getDate() + 1);
      end = dayInMonth(y, m + 1, billingDay);
    } else {
      const previous = dayInMonth(y, m - 1, billingDay);
      start = new Date(previous.getFullYear(), previous.getMonth(), previous.getDate() + 1);
      end = statementThisMonth;
    }
  }

  let due: Date | null = null;
  if (dueDay) {
    due = dayInMonth(end.getFullYear(), end.getMonth(), dueDay);
    if (due <= end) due = dayInMonth(end.getFullYear(), end.getMonth() + 1, dueDay);
  }

  return { start: toISODate(start), end: toISODate(end), due: due ? toISODate(due) : null };
}
