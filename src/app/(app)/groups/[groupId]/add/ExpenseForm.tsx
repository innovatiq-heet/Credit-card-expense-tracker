"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, cx, ErrorText, Field, Input, Panel, Select } from "@/components/ui";
import { CATEGORIES } from "@/lib/constants";
import { todayISO } from "@/lib/dates";
import { type GroupBasics, namer } from "@/lib/groupData";
import { formatPaise, parseAmount, splitEqually, toRupees } from "@/lib/money";
import { errorMessage, run, supabase } from "@/lib/supabase";
import type { Txn } from "@/lib/types";

type Props = { basics: GroupBasics; existing: Txn | null; me: string; onSaved: () => void };

const CASH = "cash";

export function ExpenseForm({ basics, existing, me, onSaved }: Props) {
  const router = useRouter();
  const names = namer(basics.members, me);
  const members = basics.activeMembers;
  const memberIds = members.map((m) => m.user_id);
  const groupId = basics.group.id;

  // Cards this expense can be charged to (keep the current card when editing, even if it was unshared since).
  const cardOptions = [...basics.sharedCards];
  if (existing?.card_id && !cardOptions.some((c) => c.id === existing.card_id)) {
    const card = basics.cards.get(existing.card_id);
    if (card) cardOptions.push(card);
  }
  const defaultSource = existing
    ? (existing.card_id ?? CASH)
    : (cardOptions.find((c) => c.owner_id === me)?.id ?? cardOptions[0]?.id ?? CASH);

  const [amountText, setAmountText] = useState(existing ? String(existing.amount) : "");
  const [merchant, setMerchant] = useState(existing?.merchant ?? "");
  const [source, setSource] = useState(defaultSource);
  const [payer, setPayer] = useState(existing && !existing.card_id ? existing.paid_by : me);
  const [buyer, setBuyer] = useState(existing ? (existing.purchased_by ?? "") : me);
  const [date, setDate] = useState(existing?.txn_date ?? todayISO());
  const [cat, setCat] = useState(existing?.category ?? "shopping");
  const [method, setMethod] = useState<"equal" | "exact">(existing?.split_method ?? "equal");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(existing ? existing.transaction_splits.map((s) => s.user_id) : [me]),
  );
  const [exact, setExact] = useState<Record<string, string>>(
    existing ? Object.fromEntries(existing.transaction_splits.map((s) => [s.user_id, String(s.amount)])) : {},
  );
  const [splitTouched, setSplitTouched] = useState(Boolean(existing));
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = parseAmount(amountText) ?? 0;
  const ordered = memberIds.filter((id) => selected.has(id));
  const equalShares = splitEqually(total, ordered);
  const exactShares = new Map(memberIds.map((id) => [id, exact[id]?.trim() ? parseAmount(exact[id]) : 0]));
  const exactInvalid = [...exactShares.values()].some((v) => v === null);
  const assigned = [...exactShares.values()].reduce<number>((s, v) => s + (v ?? 0), 0);
  const remaining = total - assigned;

  const paidBy = source === CASH ? payer : (basics.cards.get(source)?.owner_id ?? "");
  const shares: Array<[string, number]> =
    method === "equal" ? [...equalShares.entries()] : [...exactShares.entries()].filter((e): e is [string, number] => (e[1] ?? 0) > 0);

  function chooseBuyer(id: string) {
    setBuyer(id);
    if (!splitTouched && id) setSelected(new Set([id]));
  }

  function toggle(id: string) {
    setSplitTouched(true);
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function selectOnly(ids: string[]) {
    setSplitTouched(true);
    setSelected(new Set(ids));
    if (method === "exact" && total > 0) {
      const even = splitEqually(total, memberIds.filter((id) => ids.includes(id)));
      setExact(Object.fromEntries([...even.entries()].map(([id, p]) => [id, (p / 100).toString()])));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!total) return setError("Enter the amount, e.g. 1250 or 1250.50");
    if (!merchant.trim()) return setError("Add a short description, e.g. Amazon");
    if (method === "equal" && ordered.length === 0) return setError("Select at least one person to split with");
    if (method === "exact") {
      if (exactInvalid) return setError("One of the amounts is not valid");
      if (remaining !== 0)
        return setError(
          remaining > 0 ? `${formatPaise(remaining)} is still not assigned to anyone` : `Shares are ${formatPaise(-remaining)} more than the total`,
        );
    }

    setBusy(true);
    try {
      await run(
        supabase().rpc("save_transaction", {
          p_id: existing?.id ?? null,
          p_group: groupId,
          p_card: source === CASH ? null : source,
          p_paid_by: source === CASH ? payer : null,
          p_purchased_by: buyer || null,
          p_merchant: merchant.trim(),
          p_note: note.trim(),
          p_category: cat,
          p_txn_date: date,
          p_amount: toRupees(total),
          p_split_method: method,
          p_splits: shares.map(([user_id, paise]) => ({ user_id, amount: toRupees(paise) })),
        }),
      );
      onSaved();
      router.push(`/groups/${groupId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const owing = shares.filter(([id]) => id !== paidBy);

  return (
    <form onSubmit={submit} className="space-y-4">
      <Panel className="space-y-4">
        <Field label="Amount">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-slate-400">₹</span>
            <Input
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="0"
              className="pl-8 text-2xl font-semibold"
              autoFocus={!existing}
              required
            />
          </div>
        </Field>
        <Field label="What was it?">
          <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Amazon, Swiggy, Petrol…" maxLength={80} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Bought by">
            <Select value={buyer} onChange={(e) => chooseBuyer(e.target.value)}>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {names.name(m.user_id)}
                </option>
              ))}
              <option value="">Not sure / unknown</option>
            </Select>
          </Field>
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Category</span>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c.key}
                onClick={() => setCat(c.key)}
                className={cx(
                  "rounded-full border px-3 py-1 text-sm",
                  cat === c.key ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600",
                )}
              >
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <Panel className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Paid with</p>
        {cardOptions.map((c) => (
          <label
            key={c.id}
            className={cx(
              "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5",
              source === c.id ? "border-indigo-600 bg-indigo-50" : "border-slate-200",
            )}
          >
            <input type="radio" name="source" checked={source === c.id} onChange={() => setSource(c.id)} className="accent-indigo-600" />
            <span className="text-sm">
              💳 <span className="font-medium">{names.card(c)}</span>
              {c.bank_name && <span className="text-slate-500"> · {c.bank_name}</span>}
            </span>
          </label>
        ))}
        <label
          className={cx(
            "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5",
            source === CASH ? "border-indigo-600 bg-indigo-50" : "border-slate-200",
          )}
        >
          <input type="radio" name="source" checked={source === CASH} onChange={() => setSource(CASH)} className="accent-indigo-600" />
          <span className="text-sm">💵 Cash / UPI / debit card</span>
        </label>
        {source === CASH && (
          <Field label="Who paid?">
            <Select value={payer} onChange={(e) => setPayer(e.target.value)}>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {names.name(m.user_id)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {cardOptions.length === 0 && (
          <p className="text-xs text-slate-500">
            No cards are shared with this group yet. Card owners can share one from the{" "}
            <Link href="/cards" className="text-indigo-600">
              Cards page
            </Link>
            .
          </p>
        )}
      </Panel>

      <Panel className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-700">Who pays for it?</p>
          <div className="flex whitespace-nowrap rounded-xl bg-slate-100 p-0.5 text-sm">
            {(["equal", "exact"] as const).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => {
                  setSplitTouched(true);
                  setMethod(m);
                  if (m === "exact" && Object.keys(exact).length === 0) {
                    setExact(Object.fromEntries([...equalShares.entries()].map(([id, p]) => [id, (p / 100).toString()])));
                  }
                }}
                className={cx("rounded-lg px-3 py-1", method === m ? "bg-white font-medium shadow-sm" : "text-slate-500")}
              >
                {m === "equal" ? "Split equally" : "Exact amounts"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          <button type="button" onClick={() => selectOnly(memberIds)} className="rounded-full border border-slate-200 px-2.5 py-1">
            Everyone
          </button>
          {buyer && (
            <button type="button" onClick={() => selectOnly([buyer])} className="rounded-full border border-slate-200 px-2.5 py-1">
              Only {names.obj(buyer)}
            </button>
          )}
        </div>

        <ul className="divide-y divide-slate-100">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 py-2">
              {method === "equal" ? (
                <>
                  <input
                    type="checkbox"
                    checked={selected.has(m.user_id)}
                    onChange={() => toggle(m.user_id)}
                    className="h-4 w-4 accent-indigo-600"
                    id={`split-${m.user_id}`}
                  />
                  <label htmlFor={`split-${m.user_id}`} className="flex-1 text-sm">
                    {names.name(m.user_id)}
                  </label>
                  <span className="text-sm tabular-nums text-slate-600">
                    {selected.has(m.user_id) ? formatPaise(equalShares.get(m.user_id) ?? 0) : "–"}
                  </span>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{names.name(m.user_id)}</span>
                  <Input
                    inputMode="decimal"
                    value={exact[m.user_id] ?? ""}
                    onChange={(e) => {
                      setSplitTouched(true);
                      setExact({ ...exact, [m.user_id]: e.target.value });
                    }}
                    placeholder="0"
                    className="w-28 py-1.5 text-right"
                  />
                </>
              )}
            </li>
          ))}
        </ul>
        {method === "exact" && total > 0 && (
          <p className={cx("text-right text-sm", remaining === 0 ? "text-emerald-600" : "text-amber-600")}>
            {remaining === 0
              ? "All assigned ✓"
              : remaining > 0
                ? `${formatPaise(remaining)} left to assign`
                : `${formatPaise(-remaining)} over the total`}
          </p>
        )}

        {total > 0 && paidBy && (
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {owing.length === 0 ? (
              <>Nobody owes anything – it&apos;s {paidBy === me ? "your" : `${names.name(paidBy)}'s`} own expense.</>
            ) : (
              owing.map(([id, paise]) => (
                <p key={id}>
                  {names.name(id)} {id === me ? "owe" : "will owe"} {paidBy === me ? "you" : names.name(paidBy)}{" "}
                  <span className="font-medium text-slate-900">{formatPaise(paise)}</span>
                </p>
              ))
            )}
          </div>
        )}
      </Panel>

      <Panel>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Order #, who it was for…" maxLength={500} />
        </Field>
      </Panel>

      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy} className="w-full py-3 text-base">
        {busy ? "Saving…" : existing ? "Save changes" : "Add expense"}
      </Button>
    </form>
  );
}
