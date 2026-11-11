"use client";

import { useState } from "react";
import { useUserId } from "@/components/AuthProvider";
import { Badge, Button, cx, Empty, ErrorText, PageHeader, Panel, Spinner } from "@/components/ui";
import { currentCycle, formatDate } from "@/lib/dates";
import { formatPaise, sumPaise, toPaise } from "@/lib/money";
import { errorMessage, run, supabase } from "@/lib/supabase";
import type { Card, Share } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { CardForm } from "./CardForm";

type CycleExpense = { id: string; card_id: string; amount: number; txn_date: string; expense_shares: Share[] };

async function loadCards() {
  const db = supabase();
  const cards = await run<Card[]>(db.from("cards").select("*").order("created_at"));

  // What was charged to each card in its current billing cycle.
  const cycles = new Map(cards.map((c) => [c.id, currentCycle(c.billing_day, c.due_day)]));
  const earliest = [...cycles.values()].map((c) => c.start).sort()[0];
  const [expenses, people] = earliest
    ? await Promise.all([
        run<CycleExpense[]>(
          db
            .from("expenses")
            .select("id, card_id, amount, txn_date, expense_shares(person_id, amount)")
            .in("card_id", cards.map((c) => c.id))
            .gte("txn_date", earliest),
        ),
        run<{ id: string; name: string }[]>(db.from("people").select("id, name")),
      ])
    : [[], []];

  return { cards, cycles, expenses, people: new Map(people.map((p) => [p.id, p.name])) };
}

type CardsData = Awaited<ReturnType<typeof loadCards>>;

export default function CardsPage() {
  const me = useUserId();
  const { data, error, reload } = useAsync(loadCards, me);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <PageHeader
        title="Cards"
        subtitle="Your credit cards – see what you charged this cycle and how much of it is other people's."
        action={
          !adding && (
            <Button onClick={() => setAdding(true)} className="shrink-0">
              + Add card
            </Button>
          )
        }
      />

      {adding && (
        <Panel className="mb-4">
          <CardForm
            onDone={(saved) => {
              setAdding(false);
              if (saved) reload();
            }}
          />
        </Panel>
      )}

      {!data ? (
        error ? <ErrorText>{error}</ErrorText> : <Spinner />
      ) : data.cards.length === 0 ? (
        <Empty title="No cards yet">
          Cards are optional. Add one to choose it when you add an expense and to see a per-card summary.
        </Empty>
      ) : (
        <div className="space-y-4">
          {data.cards.map((c) => (
            <CardPanel key={c.id} card={c} data={data} reload={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function CardPanel({ card, data, reload }: { card: Card; data: CardsData; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cycle = data.cycles.get(card.id)!;
  const expenses = data.expenses.filter((e) => e.card_id === card.id && e.txn_date >= cycle.start && e.txn_date <= cycle.end);
  const total = sumPaise(expenses.map((e) => e.amount));

  let mine = 0;
  const perPerson = new Map<string, number>();
  for (const e of expenses) {
    for (const s of e.expense_shares) {
      if (s.person_id === null) mine += toPaise(s.amount);
      else perPerson.set(s.person_id, (perPerson.get(s.person_id) ?? 0) + toPaise(s.amount));
    }
  }

  async function toggleActive() {
    setBusy(true);
    setError(null);
    try {
      await run(supabase().from("cards").update({ is_active: !card.is_active }).eq("id", card.id));
      reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <Panel>
        <CardForm
          card={card}
          onDone={(saved) => {
            setEditing(false);
            if (saved) reload();
          }}
        />
      </Panel>
    );
  }

  return (
    <div className={cx("overflow-hidden rounded-2xl border border-slate-200 bg-white", !card.is_active && "opacity-60")}>
      <div className="bg-gradient-to-br from-indigo-600 to-violet-700 px-4 py-4 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-lg font-semibold">{card.nickname}</p>
            <p className="text-sm text-indigo-100">{card.bank_name || "Credit card"}</p>
          </div>
          {!card.is_active && <Badge>inactive</Badge>}
        </div>
        <p className="mt-4 font-mono text-lg tracking-widest">•••• •••• •••• {card.last_four}</p>
        <p className="mt-1 text-xs text-indigo-100">
          {card.billing_day ? `Statement on day ${card.billing_day}` : "No statement day set"}
          {card.due_day ? ` · Due on day ${card.due_day}` : ""}
        </p>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium text-slate-700">
              This cycle <span className="font-normal text-slate-500">({formatDate(cycle.start)} – {formatDate(cycle.end)})</span>
            </p>
            <p className="font-semibold tabular-nums">{formatPaise(total)}</p>
          </div>
          {cycle.due && <p className="text-xs text-slate-500">Bill due {formatDate(cycle.due, true)}</p>}
          {total > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              <li className="flex justify-between">
                <span className="text-slate-600">Your own share</span>
                <span className="tabular-nums">{formatPaise(mine)}</span>
              </li>
              {[...perPerson.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([id, paise]) => (
                  <li key={id} className="flex justify-between">
                    <span className="text-slate-600">{data.people.get(id) ?? "Someone"}</span>
                    <span className="tabular-nums text-emerald-600">{formatPaise(paise)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>

        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button size="sm" variant={card.is_active ? "danger" : "secondary"} disabled={busy} onClick={toggleActive}>
            {card.is_active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
