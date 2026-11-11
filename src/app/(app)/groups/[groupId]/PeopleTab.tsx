"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Avatar, Button, Empty, ErrorText, Field, Input, LinkButton, Money, Panel, SectionTitle, Select } from "@/components/ui";
import { PAYMENT_METHODS, whatsappLink } from "@/lib/constants";
import { formatDate, todayISO } from "@/lib/dates";
import type { GroupData, Names } from "@/lib/groupData";
import { formatPaise, parseAmount, toPaise, toRupees } from "@/lib/money";
import { errorMessage, type QueryResult, run, supabase } from "@/lib/supabase";
import type { PersonBalance } from "@/lib/types";

type Props = { data: GroupData; names: Names; reload: () => void };

const PHONE = /^[0-9+ ()-]{6,20}$/;

export function PeopleTab({ data, names, reload }: Props) {
  const balances = [...data.balances].sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));

  return (
    <div>
      <AddPersonForm groupId={data.group.id} reload={reload} />

      <SectionTitle>Who owes you</SectionTitle>
      {balances.length === 0 ? (
        <Empty title="No people yet">Add the friends you share expenses with. They don&apos;t need an account.</Empty>
      ) : (
        <div className="space-y-3">
          {balances.map((b) => (
            <PersonCard key={b.person_id} balance={b} data={data} reload={reload} />
          ))}
        </div>
      )}

      <SectionTitle>Money received</SectionTitle>
      <PaymentHistory data={data} names={names} reload={reload} />

      <GroupSettings data={data} reload={reload} />
    </div>
  );
}

function AddPersonForm({ groupId, reload }: { groupId: string; reload: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (phone.trim() && !PHONE.test(phone.trim())) return setError("Phone number looks wrong");
    setBusy(true);
    setError(null);
    try {
      await run(supabase().from("people").insert({ group_id: groupId, name: name.trim(), phone: phone.trim() || null }));
      setName("");
      setPhone("");
      reload();
    } catch (err) {
      const message = errorMessage(err);
      setError(message.includes("duplicate") ? "This name is already in the group" : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <form onSubmit={add} className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Add a person</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Amit" required maxLength={60} />
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="WhatsApp number (optional)"
            inputMode="tel"
            maxLength={20}
          />
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add"}
          </Button>
        </div>
        <ErrorText>{error}</ErrorText>
      </form>
    </Panel>
  );
}

function PersonCard({ balance, data, reload }: { balance: PersonBalance; data: GroupData; reload: () => void }) {
  const { profile } = useAuth();
  const [mode, setMode] = useState<"view" | "pay" | "edit">("view");
  const [showDetails, setShowDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paise = toPaise(balance.balance);
  const owed = toPaise(balance.owed);
  const paid = toPaise(balance.paid);
  const shares = data.expenses.flatMap((e) => {
    const share = e.expense_shares.find((s) => s.person_id === balance.person_id);
    return share ? [{ id: e.id, merchant: e.merchant, date: e.txn_date, paise: toPaise(share.amount) }] : [];
  });
  const payments = data.payments.filter((p) => p.person_id === balance.person_id);
  const canRemove = shares.length === 0 && payments.length === 0;

  const itemLines = shares.slice(0, 8).map((s) => `• ${s.merchant} (${formatDate(s.date)}): ${formatPaise(s.paise)}`);
  if (shares.length > 8) itemLines.push(`• …and ${shares.length - 8} more`);
  const reminder = [
    `Hi ${balance.name.split(" ")[0]}, you owe me ${formatPaise(paise)} for “${data.group.name}”.`,
    ...itemLines,
    paid > 0 ? `Already received: ${formatPaise(paid)}` : "",
    profile?.upi_id ? `Pay by UPI: ${profile.upi_id}` : "",
    "Thanks!",
  ]
    .filter(Boolean)
    .join("\n");

  async function remove() {
    if (!confirm(`Remove ${balance.name} from this group?`)) return;
    setBusy(true);
    setError(null);
    try {
      await run(supabase().from("people").delete().eq("id", balance.person_id));
      reload();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="flex items-center gap-3">
        <Avatar name={balance.name} id={balance.person_id} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{balance.name}</p>
          <p className="truncate text-xs text-slate-500">
            {paise > 0 ? "owes you" : paise < 0 ? "paid extra – you owe back" : owed > 0 ? "settled ✓" : "no expenses yet"}
            {balance.phone ? ` · ${balance.phone}` : ""}
          </p>
        </div>
        <span className="text-xl">
          <Money paise={paise} />
        </span>
      </div>

      {mode === "view" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {paise > 0 && (
            <>
              <LinkButton href={whatsappLink(reminder, balance.phone)} external variant="secondary">
                Remind on WhatsApp
              </LinkButton>
              <Button size="sm" onClick={() => setMode("pay")}>
                Received money
              </Button>
            </>
          )}
          {(shares.length > 0 || payments.length > 0) && (
            <Button size="sm" variant="ghost" onClick={() => setShowDetails(!showDetails)}>
              {showDetails ? "Hide details" : "Details"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setMode("edit")}>
            Edit
          </Button>
          {canRemove && (
            <Button size="sm" variant="ghost" onClick={remove} disabled={busy} className="text-rose-600">
              Remove
            </Button>
          )}
        </div>
      )}
      <ErrorText>{error}</ErrorText>

      {mode === "pay" && (
        <PaymentForm
          groupId={data.group.id}
          personId={balance.person_id}
          name={balance.name}
          defaultPaise={Math.max(paise, 0)}
          onCancel={() => setMode("view")}
          onSaved={() => {
            setMode("view");
            reload();
          }}
        />
      )}

      {mode === "edit" && (
        <EditPersonForm
          balance={balance}
          onCancel={() => setMode("view")}
          onSaved={() => {
            setMode("view");
            reload();
          }}
        />
      )}

      {showDetails && mode === "view" && (
        <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
          {shares.map((s) => (
            <div key={s.id} className="flex justify-between gap-3">
              <span className="truncate text-slate-700">
                {s.merchant} <span className="text-slate-400">· {formatDate(s.date)}</span>
              </span>
              <span className="shrink-0 tabular-nums">{formatPaise(s.paise)}</span>
            </div>
          ))}
          {payments.map((p) => (
            <div key={p.id} className="flex justify-between gap-3 text-emerald-700">
              <span className="truncate">
                Paid you <span className="text-emerald-600/70">· {formatDate(p.paid_on)}</span>
              </span>
              <span className="shrink-0 tabular-nums">−{formatPaise(toPaise(p.amount))}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-slate-100 pt-1 font-medium">
            <span>{paise >= 0 ? "Still to collect" : "Paid extra"}</span>
            <span className="tabular-nums">{formatPaise(Math.abs(paise))}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function PaymentForm({
  groupId,
  personId,
  name,
  defaultPaise,
  onCancel,
  onSaved,
}: {
  groupId: string;
  personId: string;
  name: string;
  defaultPaise: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(defaultPaise > 0 ? (defaultPaise / 100).toFixed(2).replace(/\.00$/, "") : "");
  const [method, setMethod] = useState("upi");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const paise = parseAmount(amount);
    if (!paise) return setError("Enter a valid amount");
    setBusy(true);
    setError(null);
    try {
      await run(
        supabase().from("payments").insert({
          group_id: groupId,
          person_id: personId,
          amount: toRupees(paise),
          method,
          note: note.trim(),
          paid_on: date,
        }),
      );
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <p className="text-sm font-medium text-slate-700">Money received from {name}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label="Amount (₹)" hint="Change it for a part payment">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="How">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note / UPI reference (optional)" maxLength={200} />
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EditPersonForm({ balance, onCancel, onSaved }: { balance: PersonBalance; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(balance.name);
  const [phone, setPhone] = useState(balance.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (phone.trim() && !PHONE.test(phone.trim())) return setError("Phone number looks wrong");
    setBusy(true);
    setError(null);
    try {
      await run(
        supabase()
          .from("people")
          .update({ name: name.trim(), phone: phone.trim() || null })
          .eq("id", balance.person_id),
      );
      onSaved();
    } catch (err) {
      const message = errorMessage(err);
      setError(message.includes("duplicate") ? "This name is already in the group" : message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} aria-label="Name" />
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="WhatsApp number (optional)"
          inputMode="tel"
          maxLength={20}
          aria-label="Phone"
        />
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PaymentHistory({ data, names, reload }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function undo(id: string) {
    if (!confirm("Remove this payment? The person's balance will go back up.")) return;
    setBusyId(id);
    setError(null);
    try {
      await run(supabase().from("payments").delete().eq("id", id));
      reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  if (data.payments.length === 0) return <Empty title="Nothing received yet" />;

  return (
    <>
      <ErrorText>{error}</ErrorText>
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {data.payments.map((p) => {
          const method = PAYMENT_METHODS.find((m) => m.key === p.method)?.label ?? p.method;
          return (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="text-lg">💸</span>
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-medium">{names.name(p.person_id)}</span>
                  <span className="text-slate-500"> paid you</span>
                </p>
                <p className="truncate text-xs text-slate-500">
                  {formatDate(p.paid_on)} · {method}
                  {p.note ? ` · ${p.note}` : ""}
                </p>
              </div>
              <div className="text-right">
                <Money paise={toPaise(p.amount)} tone="plain" />
                <button
                  onClick={() => undo(p.id)}
                  disabled={busyId === p.id}
                  className="block text-xs text-rose-600 hover:underline disabled:text-rose-300"
                >
                  Undo
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function GroupSettings({ data, reload }: { data: GroupData; reload: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(data.group.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => PromiseLike<QueryResult>, after: () => void) {
    setBusy(true);
    setError(null);
    try {
      await run(fn());
      after();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionTitle>Group settings</SectionTitle>
      <Panel className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => supabase().from("groups").update({ name: name.trim() }).eq("id", data.group.id), reload);
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} aria-label="Group name" />
          <Button type="submit" variant="secondary" disabled={busy || name.trim() === data.group.name}>
            Rename
          </Button>
        </form>
        <ErrorText>{error}</ErrorText>
        <Button
          variant="danger"
          size="sm"
          disabled={busy}
          onClick={() =>
            confirm(`Delete “${data.group.name}” with all its people, expenses and payments? This cannot be undone.`) &&
            void act(
              () => supabase().from("groups").delete().eq("id", data.group.id),
              () => router.push("/groups"),
            )
          }
        >
          Delete group
        </Button>
      </Panel>
    </>
  );
}
