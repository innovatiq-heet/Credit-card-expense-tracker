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

/** UPI deep link – opens GPay / PhonePe / Paytm on phones. */
export function upiLink(upiId: string, name: string, amountPaise: number, note: string): string {
  const params = new URLSearchParams({
    pa: upiId,
    pn: name,
    am: (amountPaise / 100).toFixed(2),
    cu: "INR",
    tn: note.slice(0, 50),
  });
  return `upi://pay?${params.toString()}`;
}

export function whatsappLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
