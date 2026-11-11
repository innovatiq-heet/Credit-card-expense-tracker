"use client";

import { useState } from "react";
import { Button, Empty, ErrorText, LinkButton, Panel, Select } from "@/components/ui";
import { category } from "@/lib/constants";
import { formatDate, formatMonth, monthKey } from "@/lib/dates";
import type { GroupData, Names } from "@/lib/groupData";
import { formatPaise, sumPaise, toPaise } from "@/lib/money";
import { errorMessage, run, supabase } from "@/lib/supabase";
import type { Expense } from "@/lib/types";

type Props = { data: GroupData; names: Names; reload: () => void };

const myShareOf = (e: Expense) => toPaise(e.expense_shares.find((s) => s.person_id === null)?.amount ?? 0);

export function ExpensesTab({ data, names, reload }: Props) {
  const [monthChoice, setMonth] = useState("all");
  const [sourceChoice, setSource] = useState("all"); // "all" | "cash" | card id
  const [openId, setOpenId] = useState<string | null>(null);

  const months = [...new Set(data.expenses.map((e) => monthKey(e.txn_date)))];
  const usedCardIds = [...new Set(data.expenses.flatMap((e) => (e.card_id ? [e.card_id] : [])))];
  // If the chosen month/card has no expenses left (e.g. its last one was deleted), show everything.
  const month = months.includes(monthChoice) ? monthChoice : "all";
  const source = sourceChoice === "cash" || usedCardIds.includes(sourceChoice) ? sourceChoice : "all";

  const visible = data.expenses.filter(
    (e) =>
      (month === "all" || monthKey(e.txn_date) === month) &&
      (source === "all" || (source === "cash" ? e.card_id === null : e.card_id === source)),
  );

  if (data.expenses.length === 0) {
    return (
      <Empty title="No expenses yet">
        <p>Add an expense and pick the people who share it. You can add new people right in the form.</p>
        <LinkButton href={`/groups/${data.group.id}/add`} className="mt-3">
          + Add expense
        </LinkButton>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          <option value="all">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonth(m)}
            </option>
          ))}
        </Select>
        <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Paid with">
          <option value="all">All cards & cash</option>
          {usedCardIds.map((id) => (
            <option key={id} value={id}>
              {names.card(data.cards.get(id))}
            </option>
          ))}
          <option value="cash">Cash / UPI</option>
        </Select>
      </div>

      <Summary expenses={visible} data={data} names={names} />

      {visible.length === 0 ? (
        <Empty title="Nothing here for this filter" />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {visible.map((e) => (
            <ExpenseRow
              key={e.id}
              expense={e}
              data={data}
              names={names}
              open={openId === e.id}
              onToggle={() => setOpenId(openId === e.id ? null : e.id)}
              reload={reload}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Summary({ expenses, data, names }: { expenses: Expense[]; data: GroupData; names: Names }) {
  const total = sumPaise(expenses.map((e) => e.amount));
  const mine = expenses.reduce((sum, e) => sum + myShareOf(e), 0);

  const byCategory = new Map<string, number>();
  const bySource = new Map<string, number>();
  for (const e of expenses) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + toPaise(e.amount));
    const key = e.card_id ? names.card(data.cards.get(e.card_id)) : "Cash / UPI";
    bySource.set(key, (bySource.get(key) ?? 0) + toPaise(e.amount));
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <Panel>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">You paid</p>
          <p className="text-xl font-bold tabular-nums text-slate-900">{formatPaise(total)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Your share</p>
          <p className="text-xl font-semibold tabular-nums text-slate-700">{formatPaise(mine)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Others&apos; share</p>
          <p className="text-xl font-semibold tabular-nums text-emerald-600">{formatPaise(total - mine)}</p>
        </div>
      </div>

      {total > 0 && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500">By category</p>
            {categories.slice(0, 6).map(([key, paise]) => {
              const c = category(key);
              return (
                <div key={key}>
                  <div className="flex justify-between text-sm">
                    <span>
                      {c.emoji} {c.label}
                    </span>
                    <span className="tabular-nums text-slate-600">{formatPaise(paise)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${(paise / total) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-500">Paid with</p>
            {sources.map(([label, paise]) => (
              <div key={label} className="flex justify-between gap-2 text-sm">
                <span className="truncate">{label === "Cash / UPI" ? "💵" : "💳"} {label}</span>
                <span className="shrink-0 tabular-nums text-slate-600">{formatPaise(paise)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function ExpenseRow({
  expense,
  data,
  names,
  open,
  onToggle,
  reload,
}: {
  expense: Expense;
  data: GroupData;
  names: Names;
  open: boolean;
  onToggle: () => void;
  reload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = category(expense.category);
  const amount = toPaise(expense.amount);
  const toGetBack = amount - myShareOf(expense);
  const others = expense.expense_shares.filter((s) => s.person_id !== null);
  const paidWith = expense.card_id ? names.card(data.cards.get(expense.card_id)) : "Cash / UPI";

  async function remove() {
    if (!confirm(`Delete “${expense.merchant}”? It will no longer count in balances.`)) return;
    setBusy(true);
    setError(null);
    try {
      await run(supabase().from("expenses").delete().eq("id", expense.id));
      reload();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <li>
      <button onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-lg">
          {c.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-900">{expense.merchant}</p>
          <p className="truncate text-xs text-slate-500">
            {formatDate(expense.txn_date)} · {paidWith}
          </p>
          <p className="truncate text-xs text-slate-500">
            {others.length === 0 ? "Only you" : `With ${others.map((s) => names.name(s.person_id)).join(", ")}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-slate-900">{formatPaise(amount)}</p>
          {toGetBack > 0 ? (
            <p className="text-xs font-medium text-emerald-600">others owe {formatPaise(toGetBack)}</p>
          ) : (
            <p className="text-xs font-medium text-slate-400">your expense</p>
          )}
        </div>
      </button>

      {open && (
        <div className="space-y-3 bg-slate-50 px-4 pb-4 pt-1 text-sm">
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">
              Shares {expense.split_method === "equal" ? "(split equally)" : "(exact amounts)"}
            </p>
            <ul className="space-y-0.5">
              {expense.expense_shares.map((s) => (
                <li key={s.person_id ?? "me"} className="flex justify-between">
                  <span>{names.name(s.person_id)}</span>
                  <span className="tabular-nums">{formatPaise(toPaise(s.amount))}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-slate-500">
            {c.label} · paid by you with {paidWith}
          </p>
          {expense.note && <p className="rounded-lg bg-white px-3 py-2 text-slate-700">{expense.note}</p>}
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-2">
            <LinkButton href={`/groups/${data.group.id}/add?edit=${expense.id}`} variant="secondary">
              Edit
            </LinkButton>
            <Button size="sm" variant="danger" onClick={remove} disabled={busy}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
