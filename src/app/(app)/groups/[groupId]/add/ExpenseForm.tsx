"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, cx, ErrorText, Field, Input, Panel } from "@/components/ui";
import { CATEGORIES } from "@/lib/constants";
import { todayISO } from "@/lib/dates";
import type { GroupBasics } from "@/lib/groupData";
import { formatPaise, parseAmount, splitEqually, toRupees } from "@/lib/money";
import { errorMessage, run, supabase } from "@/lib/supabase";
import type { Expense, Person } from "@/lib/types";

type Props = { basics: GroupBasics; existing: Expense | null; onSaved: () => void };

const CASH = "cash";
const ME = "me"; // key for your own share (person_id null in the database)

export function ExpenseForm({ basics, existing, onSaved }: Props) {
  const router = useRouter();
  const groupId = basics.group.id;

  // People can be added while filling the form; merge them with the loaded list.
  const [added, setAdded] = useState<Person[]>([]);
  const people = [...basics.people, ...added.filter((a) => !basics.people.some((p) => p.id === a.id))];
  const participants = [{ key: ME, name: "You" }, ...people.map((p) => ({ key: p.id, name: p.name }))];
  const keys = participants.map((p) => p.key);
  const nameOf = (key: string) => participants.find((p) => p.key === key)?.name ?? "?";

  // Your cards (keep the current card when editing, even if it was deactivated since).
  const cardOptions = [...basics.activeCards];
  if (existing?.card_id && !cardOptions.some((c) => c.id === existing.card_id)) {
    const card = basics.cards.get(existing.card_id);
    if (card) cardOptions.push(card);
  }

  const [amountText, setAmountText] = useState(existing ? String(existing.amount) : "");
  const [merchant, setMerchant] = useState(existing?.merchant ?? "");
  const [source, setSource] = useState(existing ? (existing.card_id ?? CASH) : (cardOptions[0]?.id ?? CASH));
  const [date, setDate] = useState(existing?.txn_date ?? todayISO());
  const [cat, setCat] = useState(existing?.category ?? "shopping");
  const [method, setMethod] = useState<"equal" | "exact">(existing?.split_method ?? "equal");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(existing ? existing.expense_shares.map((s) => s.person_id ?? ME) : [ME]),
  );
  const [exact, setExact] = useState<Record<string, string>>(
    existing ? Object.fromEntries(existing.expense_shares.map((s) => [s.person_id ?? ME, String(s.amount)])) : {},
  );
  const [note, setNote] = useState(existing?.note ?? "");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = parseAmount(amountText) ?? 0;
  const ordered = keys.filter((k) => selected.has(k));
  const equalShares = splitEqually(total, ordered);
  const exactShares = new Map(keys.map((k) => [k, exact[k]?.trim() ? parseAmount(exact[k]) : 0]));
  const exactInvalid = [...exactShares.values()].some((v) => v === null);
  const assigned = [...exactShares.values()].reduce<number>((s, v) => s + (v ?? 0), 0);
  const remaining = total - assigned;

  const shares: Array<[string, number]> =
    method === "equal" ? [...equalShares.entries()] : [...exactShares.entries()].filter((e): e is [string, number] => (e[1] ?? 0) > 0);
  const owing = shares.filter(([key]) => key !== ME);
  const toGetBack = owing.reduce((sum, [, paise]) => sum + paise, 0);

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  }

  function selectOnly(only: string[]) {
    setSelected(new Set(only));
    if (method === "exact" && total > 0) {
      const even = splitEqually(total, keys.filter((k) => only.includes(k)));
      setExact(Object.fromEntries([...even.entries()].map(([k, p]) => [k, (p / 100).toString()])));
    }
  }

  async function addPerson() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setError(null);
    try {
      const person = await run<Person>(
        supabase().from("people").insert({ group_id: groupId, name }).select("*").single(),
      );
      setAdded((list) => [...list, person]);
      setSelected((current) => new Set([...current, person.id]));
      setNewName("");
    } catch (err) {
      const message = errorMessage(err);
      setError(message.includes("duplicate") ? `“${name}” is already in this group` : message);
    } finally {
      setAdding(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!total) return setError("Enter the amount, e.g. 1250 or 1250.50");
    if (!merchant.trim()) return setError("Add a short description, e.g. Amazon");
    if (method === "equal" && ordered.length === 0) return setError("Select at least one person who shares this expense");
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
        supabase().rpc("save_expense", {
          p_id: existing?.id ?? null,
          p_group: groupId,
          p_card: source === CASH ? null : source,
          p_merchant: merchant.trim(),
          p_note: note.trim(),
          p_category: cat,
          p_txn_date: date,
          p_amount: toRupees(total),
          p_split_method: method,
          p_shares: shares.map(([key, paise]) => ({ person_id: key === ME ? null : key, amount: toRupees(paise) })),
        }),
      );
      onSaved();
      router.push(`/groups/${groupId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

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
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
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
        <p className="text-sm font-medium text-slate-700">You paid with</p>
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
              💳 <span className="font-medium">{c.nickname} ••{c.last_four}</span>
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
        {cardOptions.length === 0 && (
          <p className="text-xs text-slate-500">
            Want to track which credit card you used? Add your cards on the{" "}
            <Link href="/cards" className="text-indigo-600">
              Cards page
            </Link>
            .
          </p>
        )}
      </Panel>

      <Panel className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-700">Who shares it?</p>
          <div className="flex whitespace-nowrap rounded-xl bg-slate-100 p-0.5 text-sm">
            {(["equal", "exact"] as const).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => {
                  setMethod(m);
                  if (m === "exact" && Object.keys(exact).length === 0) {
                    setExact(Object.fromEntries([...equalShares.entries()].map(([k, p]) => [k, (p / 100).toString()])));
                  }
                }}
                className={cx("rounded-lg px-3 py-1", method === m ? "bg-white font-medium shadow-sm" : "text-slate-500")}
              >
                {m === "equal" ? "Split equally" : "Exact amounts"}
              </button>
            ))}
          </div>
        </div>

        {people.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            <button type="button" onClick={() => selectOnly(keys)} className="rounded-full border border-slate-200 px-2.5 py-1">
              Everyone
            </button>
            <button
              type="button"
              onClick={() => selectOnly(keys.filter((k) => k !== ME))}
              className="rounded-full border border-slate-200 px-2.5 py-1"
            >
              Everyone except me
            </button>
            <button type="button" onClick={() => selectOnly([ME])} className="rounded-full border border-slate-200 px-2.5 py-1">
              Only me
            </button>
          </div>
        )}

        <ul className="divide-y divide-slate-100">
          {participants.map((p) => (
            <li key={p.key} className="flex items-center gap-3 py-2">
              {method === "equal" ? (
                <>
                  <input
                    type="checkbox"
                    checked={selected.has(p.key)}
                    onChange={() => toggle(p.key)}
                    className="h-4 w-4 accent-indigo-600"
                    id={`split-${p.key}`}
                  />
                  <label htmlFor={`split-${p.key}`} className="flex-1 text-sm">
                    {p.name}
                  </label>
                  <span className="text-sm tabular-nums text-slate-600">
                    {selected.has(p.key) ? formatPaise(equalShares.get(p.key) ?? 0) : "–"}
                  </span>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{p.name}</span>
                  <Input
                    inputMode="decimal"
                    value={exact[p.key] ?? ""}
                    onChange={(e) => setExact({ ...exact, [p.key]: e.target.value })}
                    placeholder="0"
                    aria-label={`Amount for ${p.name}`}
                    className="w-28 py-1.5 text-right"
                  />
                </>
              )}
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addPerson();
              }
            }}
            placeholder="Add a new person, e.g. Karan"
            maxLength={60}
            className="py-2"
          />
          <Button type="button" variant="secondary" onClick={addPerson} disabled={adding || !newName.trim()} className="shrink-0 whitespace-nowrap">
            {adding ? "Adding…" : "+ Add"}
          </Button>
        </div>

        {method === "exact" && total > 0 && (
          <p className={cx("text-right text-sm", remaining === 0 ? "text-emerald-600" : "text-amber-600")}>
            {remaining === 0
              ? "All assigned ✓"
              : remaining > 0
                ? `${formatPaise(remaining)} left to assign`
                : `${formatPaise(-remaining)} over the total`}
          </p>
        )}

        {total > 0 && shares.length > 0 && (
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {owing.length === 0 ? (
              <>Nobody owes you anything for this – it&apos;s your own expense.</>
            ) : (
              <>
                <p className="font-medium text-slate-900">You will get back {formatPaise(toGetBack)}</p>
                {owing.map(([key, paise]) => (
                  <p key={key}>
                    {nameOf(key)} owes you <span className="font-medium text-slate-900">{formatPaise(paise)}</span>
                  </p>
                ))}
              </>
            )}
          </div>
        )}
      </Panel>

      <Panel>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Order #, details…" maxLength={500} />
        </Field>
      </Panel>

      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy} className="w-full py-3 text-base">
        {busy ? "Saving…" : existing ? "Save changes" : "Add expense"}
      </Button>
    </form>
  );
}
