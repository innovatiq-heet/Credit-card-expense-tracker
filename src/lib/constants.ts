export const CATEGORIES = [
  { key: "shopping", label: "Shopping", emoji: "🛍️" },
  { key: "food", label: "Food & Dining", emoji: "🍽️" },
  { key: "groceries", label: "Groceries", emoji: "🛒" },
  { key: "travel", label: "Travel", emoji: "✈️" },
  { key: "fuel", label: "Fuel", emoji: "⛽" },
  { key: "entertainment", label: "Entertainment", emoji: "🎬" },
  { key: "electronics", label: "Electronics", emoji: "💻" },
  { key: "subscriptions", label: "Subscriptions", emoji: "🔁" },
  { key: "bills", label: "Bills", emoji: "🧾" },
  { key: "other", label: "Other", emoji: "📦" },
] as const;

export function category(key: string) {
  return CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1];
}

export const PAYMENT_METHODS = [
  { key: "upi", label: "UPI" },
  { key: "cash", label: "Cash" },
  { key: "bank", label: "Bank transfer" },
  { key: "other", label: "Other" },
] as const;

/** Phone number as WhatsApp wants it: digits with country code (India by default). */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 8 ? digits : null;
}

/** Opens WhatsApp with a prefilled message – straight to the person's chat when we have their number. */
export function whatsappLink(text: string, phone?: string | null): string {
  const number = whatsappNumber(phone);
  return `https://wa.me/${number ?? ""}?text=${encodeURIComponent(text)}`;
}
