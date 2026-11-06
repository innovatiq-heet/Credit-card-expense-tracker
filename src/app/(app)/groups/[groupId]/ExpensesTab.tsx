"use client";

import { useState } from "react";
import { Button, cx, Empty, ErrorText, LinkButton, Panel, Select } from "@/components/ui";
import { category } from "@/lib/constants";
import { formatDate, formatMonth, monthKey } from "@/lib/dates";
import type { GroupData, Names } from "@/lib/groupData";
import { formatPaise, sumPaise, toPaise } from "@/lib/money";
import { errorMessage, run, supabase } from "@/lib/supabase";
import type { Txn } from "@/lib/types";

type Props = { data: GroupData; me: string; names: Names; reload: () => void };

export function ExpensesTab({ data, me, names, reload }: Props) {
  const [month, setMonth] = useState("all");
  const [source, setSource] = useState("all"); // "all" | "cash" | card id
  const [openId, setOpenId] = useState<string | null>(null);

  const months = [...new Set(data.txns.map((t) => monthKey(t.txn_date)))];
  const usedCardIds = [...new Set(data.txns.flatMap((t) => (t.card_id ? [t.card_id] : [])))];

  const visible = data.txns.filter(
    (t) =>
      (month === "all" || monthKey(t.txn_date) === month) &&
      (source === "all" || (source === "cash" ? t.card_id === null : t.card_id === source)),
  );

  if (data.txns.length === 0) {
    return (
      <Empty title="No expenses yet">
        <p>
          {data.sharedCards.length === 0
            ? "Card owners can share a card with this group from the Cards page. Cash / UPI expenses work too."
            : "Add the first purchase made on a shared card."}
        </p>
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
        <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Card">
          <option value="all">All cards & cash</option>
          {usedCardIds.map((id) => (
            <option key={id} value={id}>
              {names.card(data.cards.get(id))}
            </option>
          ))}
          <option value="cash">Cash / UPI</option>
        </Select>
      </div>

      <Summary txns={visible} me={me} data={data} names={names} />

      {visible.length === 0 ? (
        <Empty title="Nothing here for this filter" />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {visible.map((t) => (
            <TxnRow
              key={t.id}
              txn={t}
              me={me}
              data={data}
              names={names}
              open={openId === t.id}
              onToggle={() => setOpenId(openId === t.id ? null : t.id)}
              reload={reload}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Summary({ txns, me, data, names }: { txns: Txn[]; me: string; data: GroupData; names: Names }) {
  const total = sumPaise(txns.map((t) => t.amount));
  const mine = sumPaise(txns.flatMap((t) => t.transaction_splits.filter((s) => s.user_id === me).map((s) => s.amount)));

  const byCategory = new Map<string, number>();
  const bySource = new Map<string, number>();
  for (const t of txns) {
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + toPaise(t.amount));
    const key = t.card_id ? names.card(data.cards.get(t.card_id)) : `Cash / UPI · ${names.name(t.paid_by)}`;
    bySource.set(key, (bySource.get(key) ?? 0) + toPaise(t.amount));
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <Panel>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total spent</p>
          <p className="text-2xl font-bold tabular-nums text-slate-900">{formatPaise(total)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Your share</p>
          <p className="text-lg font-semibold tabular-nums text-slate-700">{formatPaise(mine)}</p>
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
            <p className="text-xs font-medium text-slate-500">By card</p>
            {sources.map(([label, paise]) => (
              <div key={label} className="flex justify-between gap-2 text-sm">
                <span className="truncate">💳 {label}</span>
                <span className="shrink-0 tabular-nums text-slate-600">{formatPaise(paise)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function TxnRow({
  txn,
  me,
  data,
  names,
  open,
  onToggle,
  reload,
}: {
  txn: Txn;
  me: string;
  data: GroupData;
  names: Names;
  open: boolean;
  onToggle: () => void;
  reload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = category(txn.category);
  const myShare = toPaise(txn.transaction_splits.find((s) => s.user_id === me)?.amount ?? 0);
  const amount = toPaise(txn.amount);
  const canEdit = me === txn.created_by || me === txn.paid_by;

  let relation: { text: string; tone: string };
  if (txn.paid_by === me) {
    relation =
      amount - myShare > 0
        ? { text: `you lent ${formatPaise(amount - myShare)}`, tone: "text-emerald-600" }
        : { text: "your expense", tone: "text-slate-500" };
  } else if (myShare > 0) {
    relation = { text: `you owe ${formatPaise(myShare)}`, tone: "text-rose-600" };
  } else {
    relation = { text: "not involved", tone: "text-slate-400" };
  }

  const paidWith = txn.card_id ? names.card(data.cards.get(txn.card_id)) : `Cash / UPI by ${names.obj(txn.paid_by)}`;

  async function remove() {
    if (!confirm(`Delete “${txn.merchant}”? It will no longer count in balances.`)) return;
    setBusy(true);
    setError(null);
    try {
      await run(supabase().rpc("delete_transaction", { p_id: txn.id }));
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
          <p className="truncate font-medium text-slate-900">{txn.merchant}</p>
          <p className="truncate text-xs text-slate-500">
            {formatDate(txn.txn_date)} · {paidWith}
          </p>
          <p className="truncate text-xs text-slate-500">
            Bought by {names.obj(txn.purchased_by)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-slate-900">{formatPaise(amount)}</p>
          <p className={cx("text-xs font-medium", relation.tone)}>{relation.text}</p>
        </div>
      </button>

      {open && (
        <div className="space-y-3 bg-slate-50 px-4 pb-4 pt-1 text-sm">
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">
              Who pays {txn.split_method === "equal" ? "(split equally)" : "(exact amounts)"}
            </p>
            <ul className="space-y-0.5">
              {txn.transaction_splits.map((s) => (
                <li key={s.user_id} className="flex justify-between">
                  <span>{names.name(s.user_id)}</span>
                  <span className="tabular-nums">{formatPaise(toPaise(s.amount))}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-slate-500">
            Money from: <span className="font-medium text-slate-700">{names.name(txn.paid_by)}</span> · Added by{" "}
            {names.obj(txn.created_by)} · {c.label}
          </p>
          {txn.note && <p className="rounded-lg bg-white px-3 py-2 text-slate-700">{txn.note}</p>}
          <ErrorText>{error}</ErrorText>
          {canEdit ? (
            <div className="flex gap-2">
              <LinkButton href={`/groups/${data.group.id}/add?edit=${txn.id}`} variant="secondary">
                Edit
              </LinkButton>
              <Button size="sm" variant="danger" onClick={remove} disabled={busy}>
                {busy ? "Deleting…" : "Delete"}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Only the person who added it or the card owner can edit this.</p>
          )}
        </div>
      )}
    </li>
  );
}
