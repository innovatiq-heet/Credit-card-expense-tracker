"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUserId } from "@/components/AuthProvider";
import { Button, Empty, ErrorText, Input, Money, PageHeader, Panel, SectionTitle, Spinner } from "@/components/ui";
import { toPaise } from "@/lib/money";
import { errorMessage, run, supabase } from "@/lib/supabase";
import type { MyBalance } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";

async function loadGroups(me: string) {
  const db = supabase();
  const [memberships, balances] = await Promise.all([
    run<{ role: string; group: { id: string; name: string } | null }[]>(
      db.from("group_members").select("role, group:groups(id, name)").eq("user_id", me).eq("is_active", true),
    ),
    run<MyBalance[]>(db.rpc("my_balances")),
  ]);
  const net = new Map<string, number>();
  for (const b of balances) net.set(b.group_id, (net.get(b.group_id) ?? 0) + toPaise(b.amount));
  return memberships
    .flatMap((m) => (m.group ? [{ ...m.group, role: m.role, net: net.get(m.group.id) ?? 0 }] : []))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function GroupsPage() {
  const me = useUserId();
  const router = useRouter();
  const { data, error } = useAsync(() => loadGroups(me), me);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setFormError(null);
    try {
      const id = await run<string>(supabase().rpc("create_group", { p_name: name }));
      setName("");
      router.push(`/groups/${id}?tab=members`);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy("join");
    setFormError(null);
    try {
      const id = await run<string>(supabase().rpc("join_group", { p_code: code }));
      setCode("");
      router.push(`/groups/${id}`);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Groups" subtitle="Each group has its own expenses and balances." />

      {!data ? (
        error ? <ErrorText>{error}</ErrorText> : <Spinner />
      ) : data.length === 0 ? (
        <Empty title="No groups yet">Create one below, or join with a code from a friend.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {data.map((g) => (
            <li key={g.id}>
              <Link href={`/groups/${g.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-slate-50">
                <div>
                  <p className="font-medium text-slate-900">{g.name}</p>
                  {g.role === "admin" && <p className="text-xs text-slate-500">You are admin</p>}
                </div>
                <span className="text-sm">
                  {g.net === 0 ? (
                    <span className="text-slate-500">settled</span>
                  ) : (
                    <>
                      <span className="text-slate-500">{g.net > 0 ? "you get " : "you owe "}</span>
                      <Money paise={g.net} />
                    </>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2">
        <ErrorText>{formError}</ErrorText>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <SectionTitle>Create a group</SectionTitle>
          <Panel>
            <form onSubmit={create} className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmedabad Friends" required maxLength={60} />
              <Button type="submit" disabled={busy !== null}>
                {busy === "create" ? "…" : "Create"}
              </Button>
            </form>
          </Panel>
        </div>
        <div>
          <SectionTitle>Join with a code</SectionTitle>
          <Panel>
            <form onSubmit={join} className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="A1B2C3D4"
                required
                maxLength={12}
                className="font-mono tracking-widest"
              />
              <Button type="submit" variant="secondary" disabled={busy !== null}>
                {busy === "join" ? "…" : "Join"}
              </Button>
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
}
