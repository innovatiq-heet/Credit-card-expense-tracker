"use client";

import Link from "next/link";
import { ActivityList } from "@/components/ActivityList";
import { useAuth, useUserId } from "@/components/AuthProvider";
import { Avatar, Empty, ErrorText, LinkButton, Money, Panel, SectionTitle, Spinner } from "@/components/ui";
import { formatPaise, toPaise } from "@/lib/money";
import { run, supabase } from "@/lib/supabase";
import type { Activity, MyBalance } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";

type ActivityRow = Activity & { actor: { full_name: string } | null; group: { name: string } | null };

async function loadDashboard(me: string) {
  const db = supabase();
  const [balances, memberships, activity] = await Promise.all([
    run<MyBalance[]>(db.rpc("my_balances")),
    run<{ group: { id: string; name: string } | null }[]>(
      db.from("group_members").select("group:groups(id, name)").eq("user_id", me).eq("is_active", true),
    ),
    run<ActivityRow[]>(
      db
        .from("activity")
        .select("*, actor:profiles(full_name), group:groups(name)")
        .order("created_at", { ascending: false })
        .limit(10),
    ),
  ]);
  const groups = memberships.flatMap((m) => (m.group ? [m.group] : [])).sort((a, b) => a.name.localeCompare(b.name));
  return { balances, groups, activity };
}

export default function DashboardPage() {
  const me = useUserId();
  const { profile } = useAuth();
  const { data, error, loading } = useAsync(() => loadDashboard(me), me);

  if (!data) return error ? <ErrorText>{error}</ErrorText> : <Spinner />;

  const balances = [...data.balances].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const toGet = balances.filter((b) => b.amount > 0).reduce((s, b) => s + toPaise(b.amount), 0);
  const toPay = balances.filter((b) => b.amount < 0).reduce((s, b) => s - toPaise(b.amount), 0);
  const netByGroup = new Map<string, number>();
  for (const b of balances) netByGroup.set(b.group_id, (netByGroup.get(b.group_id) ?? 0) + toPaise(b.amount));
  const firstName = profile?.full_name.split(" ")[0] ?? "";

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Hi{firstName ? `, ${firstName}` : ""} 👋</h1>
      {loading && <p className="text-xs text-slate-400">Refreshing…</p>}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Panel className="bg-emerald-50/60">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">You&apos;ll get</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">{formatPaise(toGet)}</p>
        </Panel>
        <Panel className="bg-rose-50/60">
          <p className="text-xs font-medium uppercase tracking-wide text-rose-700">You owe</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-rose-700">{formatPaise(toPay)}</p>
        </Panel>
      </div>

      {data.groups.length === 0 ? (
        <div className="mt-6">
          <Empty title="Start by creating or joining a group">
            <p>Create a group for your friends, then share the invite code with them.</p>
            <LinkButton href="/groups" className="mt-3">
              Create or join a group
            </LinkButton>
          </Empty>
        </div>
      ) : (
        <>
          <SectionTitle>Settle up</SectionTitle>
          {balances.length === 0 ? (
            <Empty title="All settled up 🎉">Nobody owes anybody right now.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {balances.map((b) => (
                <li key={`${b.group_id}-${b.other_user}`}>
                  <Link
                    href={`/groups/${b.group_id}?tab=balances`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
                  >
                    <Avatar name={b.other_name} id={b.other_user} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{b.other_name}</p>
                      <p className="truncate text-xs text-slate-500">{b.group_name}</p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="text-xs text-slate-500">{b.amount > 0 ? "owes you" : "you owe"}</p>
                      <Money paise={toPaise(b.amount)} />
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
              const net = netByGroup.get(g.id) ?? 0;
              return (
                <li key={g.id}>
                  <Link href={`/groups/${g.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                    <span className="font-medium text-slate-900">{g.name}</span>
                    <span className="text-sm">
                      {net === 0 ? (
                        <span className="text-slate-500">settled</span>
                      ) : (
                        <>
                          <span className="text-slate-500">{net > 0 ? "you get " : "you owe "}</span>
                          <Money paise={net} />
                        </>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <SectionTitle>Recent activity</SectionTitle>
          <ActivityList
            items={data.activity}
            nameOf={(id) => {
              if (id === me) return "You";
              return data.activity.find((a) => a.actor_id === id)?.actor?.full_name ?? "Someone";
            }}
            groupNameOf={(gid) => data.activity.find((a) => a.group_id === gid)?.group?.name}
          />
        </>
      )}
    </div>
  );
}
