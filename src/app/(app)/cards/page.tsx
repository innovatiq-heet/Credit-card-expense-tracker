"use client";

import { useState } from "react";
import { useUserId } from "@/components/AuthProvider";
import { Avatar, Badge, Button, cx, Empty, ErrorText, PageHeader, Panel, SectionTitle, Spinner } from "@/components/ui";
import { currentCycle, formatDate } from "@/lib/dates";
import { formatPaise, sumPaise, toPaise } from "@/lib/money";
import { errorMessage, type QueryResult, run, supabase } from "@/lib/supabase";
import type { Card } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { CardForm } from "./CardForm";

type MyCard = Card & { card_groups: { group_id: string }[] };
type FriendCard = Card & { owner: { full_name: string } | null; card_groups: { group_id: string }[] };
type CycleTxn = { id: string; card_id: string; amount: number; txn_date: string; transaction_splits: { user_id: string; amount: number }[] };

async function loadCards(me: string) {
  const db = supabase();
  const [mine, friends, memberships] = await Promise.all([
    run<MyCard[]>(db.from("cards").select("*, card_groups(group_id)").eq("owner_id", me).order("created_at")),
    run<FriendCard[]>(
      db
        .from("cards")
        .select("*, owner:profiles(full_name), card_groups(group_id)")
        .neq("owner_id", me)
        .eq("is_active", true)
        .order("created_at"),
    ),
    run<{ group: { id: string; name: string } | null }[]>(
      db.from("group_members").select("group:groups(id, name)").eq("user_id", me).eq("is_active", true),
    ),
  ]);
  const groups = memberships.flatMap((m) => (m.group ? [m.group] : [])).sort((a, b) => a.name.localeCompare(b.name));

  // Charges on my cards in each card's current billing cycle.
  const cycles = new Map(mine.map((c) => [c.id, currentCycle(c.billing_day, c.due_day)]));
  const earliest = [...cycles.values()].map((c) => c.start).sort()[0];
  const txns = earliest
    ? await run<CycleTxn[]>(
        db
          .from("transactions")
          .select("id, card_id, amount, txn_date, transaction_splits(user_id, amount)")
          .in("card_id", mine.map((c) => c.id))
          .eq("is_deleted", false)
          .gte("txn_date", earliest),
      )
    : [];

  const peopleIds = [...new Set(txns.flatMap((t) => t.transaction_splits.map((s) => s.user_id)))];
  const people = peopleIds.length
    ? await run<{ id: string; full_name: string }[]>(db.from("profiles").select("id, full_name").in("id", peopleIds))
    : [];

  return {
    mine,
    friends: friends.filter((c) => c.card_groups.length > 0),
    groups,
    cycles,
    txns,
    people: new Map(people.map((p) => [p.id, p.full_name])),
  };
}

type CardsData = Awaited<ReturnType<typeof loadCards>>;

export default function CardsPage() {
  const me = useUserId();
  const { data, error, reload } = useAsync(() => loadCards(me), me);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <PageHeader
        title="Cards"
        subtitle="Your credit cards and the friends' cards you can use."
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
            me={me}
            onDone={(saved) => {
              setAdding(false);
              if (saved) reload();
            }}
          />
        </Panel>
      )}

      {!data ? (
        error ? <ErrorText>{error}</ErrorText> : <Spinner />
      ) : (
        <>
          <SectionTitle>My cards</SectionTitle>
          {data.mine.length === 0 ? (
            <Empty title="No cards yet">Add your card, then share it with a group so friends can record what they buy on it.</Empty>
          ) : (
            <div className="space-y-4">
              {data.mine.map((c) => (
                <MyCardPanel key={c.id} card={c} data={data} me={me} reload={reload} />
              ))}
            </div>
          )}

          <SectionTitle>Friends&apos; cards you can use</SectionTitle>
          {data.friends.length === 0 ? (
            <p className="text-sm text-slate-500">None yet. When a friend shares a card with one of your groups it shows up here.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {data.friends.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Avatar name={c.owner?.full_name ?? "?"} id={c.owner_id} size="sm" />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {c.owner?.full_name}&apos;s {c.nickname} ••{c.last_four}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      In: {c.card_groups.map((g) => data.groups.find((x) => x.id === g.group_id)?.name).filter(Boolean).join(", ")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function MyCardPanel({ card, data, me, reload }: { card: MyCard; data: CardsData; me: string; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cycle = data.cycles.get(card.id)!;
  const txns = data.txns.filter((t) => t.card_id === card.id && t.txn_date >= cycle.start && t.txn_date <= cycle.end);
  const total = sumPaise(txns.map((t) => t.amount));
  const perPerson = new Map<string, number>();
  for (const t of txns)
    for (const s of t.transaction_splits) perPerson.set(s.user_id, (perPerson.get(s.user_id) ?? 0) + toPaise(s.amount));
  const sharedWith = new Set(card.card_groups.map((g) => g.group_id));

  async function act(key: string, fn: () => PromiseLike<QueryResult>) {
    setBusy(key);
    setError(null);
    try {
      await run(fn());
      reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (editing) {
    return (
      <Panel>
        <CardForm
          me={me}
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

      <div className="space-y-4 p-4">
        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium text-slate-700">
              This cycle <span className="font-normal text-slate-500">({formatDate(cycle.start)} – {formatDate(cycle.end)})</span>
            </p>
            <p className="font-semibold tabular-nums">{formatPaise(total)}</p>
          </div>
          {cycle.due && <p className="text-xs text-slate-500">Bill due {formatDate(cycle.due, true)}</p>}
          {perPerson.size > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {[...perPerson.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([id, paise]) => (
                  <li key={id} className="flex justify-between">
                    <span className="text-slate-600">{id === me ? "You" : data.people.get(id) ?? "Someone"}</span>
                    <span className="tabular-nums">{formatPaise(paise)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Shared with</p>
          {data.groups.length === 0 ? (
            <p className="text-xs text-slate-500">Join or create a group first.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {data.groups.map((g) => {
                const on = sharedWith.has(g.id);
                return (
                  <button
                    key={g.id}
                    disabled={busy !== null || (!card.is_active && !on)}
                    onClick={() =>
                      act(g.id, () =>
                        on
                          ? supabase().from("card_groups").delete().eq("card_id", card.id).eq("group_id", g.id)
                          : supabase().from("card_groups").insert({ card_id: card.id, group_id: g.id }),
                      )
                    }
                    className={cx(
                      "rounded-full border px-3 py-1 text-sm disabled:opacity-50",
                      on ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600",
                    )}
                  >
                    {on ? "✓ " : "+ "}
                    {g.name}
                  </button>
                );
              })}
            </div>
          )}
          <p className="mt-1.5 text-xs text-slate-500">Everyone in a shared group can record purchases on this card.</p>
        </div>

        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant={card.is_active ? "danger" : "secondary"}
            disabled={busy !== null}
            onClick={() =>
              act("active", () => supabase().from("cards").update({ is_active: !card.is_active }).eq("id", card.id))
            }
          >
            {card.is_active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
