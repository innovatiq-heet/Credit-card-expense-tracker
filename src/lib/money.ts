// All money maths happens in whole paise (integers) to avoid floating-point
// errors. The database stores rupees as NUMERIC(12,2).

export function toPaise(rupees: number | string): number {
  return Math.round(Number(rupees) * 100);
}

/** Paise → rupees number suitable for sending to the database (e.g. 3333 → 33.33). */
export function toRupees(paise: number): number {
  return paise / 100;
}

/** Parse what a user typed ("1,250.5", "₹ 300") into paise. Returns null if invalid. */
export function parseAmount(input: string): number | null {
  const clean = input.replace(/[,\s₹]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : null;
}

/**
 * Split a total equally. Leftover paise go one each to the first people in
 * the list, so the shares always add up exactly: ₹100 / 3 → 33.34, 33.33, 33.33.
 */
export function splitEqually(totalPaise: number, userIds: string[]): Map<string, number> {
  const shares = new Map<string, number>();
  if (userIds.length === 0) return shares;
  const base = Math.floor(totalPaise / userIds.length);
  let leftover = totalPaise - base * userIds.length;
  for (const id of userIds) {
    shares.set(id, base + (leftover > 0 ? 1 : 0));
    if (leftover > 0) leftover--;
  }
  return shares;
}

export function sumPaise(values: Array<number | string>): number {
  return values.reduce<number>((total, v) => total + toPaise(v), 0);
}

const whole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format paise as Indian rupees: 500000 → "₹5,000", 3333 → "₹33.33". */
export function formatPaise(paise: number): string {
  const abs = Math.abs(paise);
  const text = abs % 100 === 0 ? whole.format(abs / 100) : exact.format(abs / 100);
  return paise < 0 ? `-${text}` : text;
}

/** Format a rupee amount from the database. */
export function formatINR(rupees: number | string): string {
  return formatPaise(toPaise(rupees));
}
