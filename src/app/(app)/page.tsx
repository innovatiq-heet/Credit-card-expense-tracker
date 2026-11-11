"use client";

import Link from "next/link";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { Avatar, Empty, ErrorText, LinkButton, Money, Panel, SectionTitle, Spinner } from "@/components/ui";
import { formatPaise, toPaise } from "@/lib/money";
import { run, supabase } from "@/lib/supabase";
import type { Group, PersonBalance } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";

async function loadDashboard() {
  const db = supabase();
  const [groups, balances] = await Promise.all([
    run<Group[]>(db.from("groups").select("*").order("created_at", { ascending: false })),
    run<PersonBalance[]>(db.from("person_balances").select("*")),
  ]);
  return { groups, balances };
}

export default function DashboardPage() {
  const me = useUserId();
  const { profile } = useAuth();
  const { data, error, loading } = useAsync(loadDashboard, me);

  if (!data) return error ? <ErrorText>{error}</ErrorText> : <Spinner />;

  const groupName = new Map(data.groups.map((g) => [g.id, g.name]));
  const open = data.balances
    .map((b) => ({ ...b, paise: toPaise(b.balance) }))
    .filter((b) => b.paise !== 0)
    .sort((a, b) => b.paise - a.paise);
  const toCollect = open.filter((b) => b.paise > 0).reduce((s, b) => s + b.paise, 0);
  const received = data.balances.reduce((s, b) => s + toPaise(b.paid), 0);
  const perGroup = new Map<string, number>();
  for (const b of open) if (b.paise > 0) perGroup.set(b.group_id, (perGroup.get(b.group_id) ?? 0) + b.paise);
  const firstName = profile?.full_name.split(" ")[0] ?? "";

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Hi{firstName ? `, ${firstName}` : ""} 👋</h1>
      {loading && <p className="text-xs text-slate-400">Refreshing…</p>}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Panel className="bg-emerald-50/60">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">To collect</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">{formatPaise(toCollect)}</p>
        </Panel>
        <Panel>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Received so far</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-700">{formatPaise(received)}</p>
        </Panel>
      </div>

      {data.groups.length === 0 ? (
        <div className="mt-6">
          <Empty title="Start by creating a group">
            <p>Make a group (a trip, flatmates, office…), add the people, then add what you paid for.</p>
            <LinkButton href="/groups" className="mt-3">
              Create a group
            </LinkButton>
          </Empty>
        </div>
      ) : (
        <>
          <SectionTitle>Who owes you</SectionTitle>
          {open.length === 0 ? (
            <Empty title="All settled up 🎉">Nobody owes you anything right now.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {open.map((b) => (
                <li key={b.person_id}>
                  <Link href={`/groups/${b.group_id}?tab=people`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <Avatar name={b.name} id={b.person_id} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{b.name}</p>
                      <p className="truncate text-xs text-slate-500">{groupName.get(b.group_id)}</p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="text-xs text-slate-500">{b.paise > 0 ? "owes you" : "paid extra"}</p>
                      <Money paise={b.paise} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <SectionTitle action={<Link href="/groups" className="text-sm text-indigo-600">All groups</Link>}>
            Your groups
          </SectionTitle>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {data.groups.map((g) => {
              const paise = perGroup.get(g.id) ?? 0;
              return (
                <li key={g.id}>
                  <Link href={`/groups/${g.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className="truncate font-medium text-slate-900">{g.name}</span>
                    <span className="shrink-0 text-sm">
                      {paise === 0 ? (
                        <span className="text-slate-500">settled</span>
                      ) : (
                        <>
                          <span className="text-slate-500">to collect </span>
                          <Money paise={paise} />
                        </>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
