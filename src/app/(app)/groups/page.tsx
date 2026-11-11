"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUserId } from "@/components/AuthProvider";
import { Button, Empty, ErrorText, Input, Money, PageHeader, Panel, SectionTitle, Spinner } from "@/components/ui";
import { toPaise } from "@/lib/money";
import { errorMessage, run, runAll, supabase } from "@/lib/supabase";
import type { Group, PersonBalance } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";

async function loadGroups() {
  const db = supabase();
  const [groups, balances] = await Promise.all([
    run<Group[]>(db.from("groups").select("*").order("created_at", { ascending: false })),
    runAll<PersonBalance>(() => db.from("person_balances").select("*").order("person_id")),
  ]);
  return groups.map((g) => {
    const mine = balances.filter((b) => b.group_id === g.id);
    return {
      ...g,
      people: mine.length,
      toCollect: mine.reduce((sum, b) => sum + Math.max(0, toPaise(b.balance)), 0),
    };
  });
}

export default function GroupsPage() {
  const me = useUserId();
  const router = useRouter();
  const { data, error } = useAsync(loadGroups, me);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const group = await run<Group>(supabase().from("groups").insert({ name: name.trim() }).select("*").single());
      setName("");
      router.push(`/groups/${group.id}?tab=people`);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Groups" subtitle="One group per trip, flat, office… Each has its own people and expenses." />

      <Panel>
        <form onSubmit={create} className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group, e.g. Goa Trip" required maxLength={60} />
          <Button type="submit" disabled={busy} className="shrink-0">
            {busy ? "…" : "Create"}
          </Button>
        </form>
        <div className="mt-2">
          <ErrorText>{formError}</ErrorText>
        </div>
      </Panel>

      <SectionTitle>Your groups</SectionTitle>
      {!data ? (
        error ? <ErrorText>{error}</ErrorText> : <Spinner />
      ) : data.length === 0 ? (
        <Empty title="No groups yet">Create your first group above.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {data.map((g) => (
            <li key={g.id}>
              <Link href={`/groups/${g.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{g.name}</p>
                  <p className="text-xs text-slate-500">
                    {g.people} {g.people === 1 ? "person" : "people"}
                  </p>
                </div>
                <span className="shrink-0 text-sm">
                  {g.toCollect === 0 ? (
                    <span className="text-slate-500">settled</span>
                  ) : (
                    <>
                      <span className="text-slate-500">to collect </span>
                      <Money paise={g.toCollect} />
                    </>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
