"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, Badge, Button, ErrorText, Input, LinkButton, Panel, SectionTitle } from "@/components/ui";
import { whatsappLink } from "@/lib/constants";
import type { GroupData, Names } from "@/lib/groupData";
import { errorMessage, run, supabase } from "@/lib/supabase";

type Props = { data: GroupData; me: string; names: Names; reload: () => void };

export function MembersTab({ data, me, names, reload }: Props) {
  const router = useRouter();
  const isAdmin = data.members.some((m) => m.user_id === me && m.role === "admin" && m.is_active);
  const former = data.members.filter((m) => !m.is_active);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(data.group.name);

  const inviteUrl = typeof window === "undefined" ? "" : `${window.location.origin}/join/${data.group.invite_code}`;
  const inviteText = `Join our group “${data.group.name}” on CardMates to track shared card expenses: ${inviteUrl} (code ${data.group.invite_code})`;

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy – long-press the code to copy it instead.");
    }
  }

  return (
    <div>
      <Panel className="bg-indigo-50/60">
        <p className="text-sm font-medium text-indigo-900">Invite friends</p>
        <p className="mt-1 text-xs text-indigo-800/80">Share the link or the code. Friends sign up, then join.</p>
        <p className="mt-3 select-all font-mono text-3xl font-bold tracking-[0.2em] text-indigo-700">{data.group.invite_code}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={copy}>
            {copied ? "Copied ✓" : "Copy invite link"}
          </Button>
          <LinkButton href={whatsappLink(inviteText)} external variant="secondary">
            Share on WhatsApp
          </LinkButton>
          {isAdmin && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() =>
                confirm("Create a new code? The old link and code will stop working.") &&
                act("code", async () => {
                  await run(supabase().rpc("regenerate_invite_code", { p_group: data.group.id }));
                  reload();
                })
              }
            >
              New code
            </Button>
          )}
        </div>
      </Panel>

      <ErrorText>{error}</ErrorText>

      <SectionTitle>Members ({data.activeMembers.length})</SectionTitle>
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {data.activeMembers.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={m.profile?.full_name ?? "?"} id={m.user_id} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-900">
                {m.profile?.full_name}
                {m.user_id === me && <span className="text-slate-500"> (you)</span>}
              </p>
              <p className="truncate text-xs text-slate-500">{m.profile?.upi_id ? `UPI: ${m.profile.upi_id}` : "No UPI ID"}</p>
            </div>
            {m.role === "admin" && <Badge tone="indigo">admin</Badge>}
          </li>
        ))}
      </ul>
      {former.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">Former members: {former.map((m) => m.profile?.full_name).join(", ")}</p>
      )}

      <SectionTitle action={<Link href="/cards" className="text-sm text-indigo-600">Manage my cards</Link>}>
        Cards in this group
      </SectionTitle>
      {data.sharedCards.length === 0 ? (
        <p className="text-sm text-slate-500">No cards shared yet. Card owners can share a card from the Cards page.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {data.sharedCards.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="text-lg">💳</span>
              <span className="font-medium">{names.card(c)}</span>
              {c.bank_name && <span className="text-slate-500">· {c.bank_name}</span>}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <>
          <SectionTitle>Group name</SectionTitle>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act("rename", async () => {
                await run(supabase().from("groups").update({ name: name.trim() }).eq("id", data.group.id));
                reload();
              });
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
            <Button type="submit" variant="secondary" disabled={busy !== null || name.trim() === data.group.name}>
              Save
            </Button>
          </form>
        </>
      )}

      <SectionTitle>Leave group</SectionTitle>
      <Panel>
        <p className="text-sm text-slate-600">
          You can leave once you owe nobody and nobody owes you. Your cards will stop being shared with this group.
        </p>
        <Button
          variant="danger"
          size="sm"
          className="mt-3"
          disabled={busy !== null}
          onClick={() =>
            confirm(`Leave “${data.group.name}”?`) &&
            act("leave", async () => {
              await run(supabase().rpc("leave_group", { p_group: data.group.id }));
              router.push("/groups");
            })
          }
        >
          Leave group
        </Button>
      </Panel>
    </div>
  );
}
