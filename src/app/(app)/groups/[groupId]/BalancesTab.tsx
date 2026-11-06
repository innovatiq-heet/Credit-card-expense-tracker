"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Avatar, Button, Empty, ErrorText, Field, Input, LinkButton, Money, Panel, SectionTitle, Select } from "@/components/ui";
import { PAYMENT_METHODS, upiLink, whatsappLink } from "@/lib/constants";
import { formatDay } from "@/lib/dates";
import type { GroupData, Names } from "@/lib/groupData";
import { formatPaise, parseAmount, toPaise, toRupees } from "@/lib/money";
import { errorMessage, run, supabase } from "@/lib/supabase";
import type { Pair } from "@/lib/types";

type Props = { data: GroupData; me: string; names: Names; reload: () => void };

export function BalancesTab({ data, me, names, reload }: Props) {
  const mine = data.pairs.filter((p) => p.from_user === me || p.to_user === me);
  const others = data.pairs.filter((p) => p.from_user !== me && p.to_user !== me);

  return (
    <div>
      <p className="text-sm text-slate-500">
        Money is owed to the person whose card (or cash) was used. Debts between two people are netted.
      </p>

      <SectionTitle>Your balances</SectionTitle>
      {mine.length === 0 ? (
        <Empty title="You're all settled up 🎉" />
      ) : (
        <div className="space-y-3">
          {mine.map((p) => (
            <PairCard key={`${p.from_user}-${p.to_user}`} pair={p} me={me} data={data} names={names} reload={reload} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <>
          <SectionTitle>Everyone else</SectionTitle>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {others.map((p) => (
              <li key={`${p.from_user}-${p.to_user}`} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>
                  <span className="font-medium">{names.name(p.from_user)}</span>
                  <span className="text-slate-500"> owes </span>
                  <span className="font-medium">{names.name(p.to_user)}</span>
                </span>
                <Money paise={toPaise(p.amount)} tone="plain" />
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionTitle>Payments</SectionTitle>
      <PaymentHistory data={data} me={me} names={names} reload={reload} />
    </div>
  );
}

function PairCard({ pair, me, data, names, reload }: { pair: Pair } & Props) {
  const { profile } = useAuth();
  const [settling, setSettling] = useState(false);
  const iOwe = pair.from_user === me;
  const other = iOwe ? pair.to_user : pair.from_user;
  const otherProfile = names.profile(other);
  const otherName = names.fullName(other);
  const paise = toPaise(pair.amount);

  const reminder =
    `Hi ${otherName.split(" ")[0]}, as per CardMates you owe me ${formatPaise(paise)} in “${data.group.name}”.` +
    (profile?.upi_id ? ` My UPI ID: ${profile.upi_id}.` : "") +
    " Thanks!";

  return (
    <Panel>
      <div className="flex items-center gap-3">
        <Avatar name={otherName} id={other} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-500">{iOwe ? "You owe" : "Owes you"}</p>
          <p className="truncate font-semibold text-slate-900">{otherName}</p>
        </div>
        <span className="text-xl">
          <Money paise={iOwe ? -paise : paise} />
        </span>
      </div>

      {!settling && (
        <div className="mt-3 flex flex-wrap gap-2">
          {iOwe ? (
            <>
              {otherProfile?.upi_id ? (
                <a
                  href={upiLink(otherProfile.upi_id, otherName, paise, `CardMates ${data.group.name}`)}
                  className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Pay via UPI
                </a>
              ) : (
                <span className="self-center text-xs text-slate-500">{otherName} hasn&apos;t added a UPI ID yet.</span>
              )}
              <Button size="sm" variant="secondary" onClick={() => setSettling(true)}>
                I paid
              </Button>
            </>
          ) : (
            <>
              <LinkButton href={whatsappLink(reminder)} external variant="secondary">
                Remind on WhatsApp
              </LinkButton>
              <Button size="sm" variant="secondary" onClick={() => setSettling(true)}>
                I received
              </Button>
            </>
          )}
        </div>
      )}
      {iOwe && otherProfile?.upi_id && !settling && (
        <p className="mt-2 text-xs text-slate-500">
          UPI ID: <span className="font-mono">{otherProfile.upi_id}</span> · after paying, tap “I paid”.
        </p>
      )}

      {settling && (
        <SettleForm
          groupId={data.group.id}
          from={pair.from_user}
          to={pair.to_user}
          defaultPaise={paise}
          title={iOwe ? `Record payment to ${otherName}` : `Record payment from ${otherName}`}
          onCancel={() => setSettling(false)}
          onSaved={() => {
            setSettling(false);
            reload();
          }}
        />
      )}
    </Panel>
  );
}

function SettleForm({
  groupId,
  from,
  to,
  defaultPaise,
  title,
  onCancel,
  onSaved,
}: {
  groupId: string;
  from: string;
  to: string;
  defaultPaise: number;
  title: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState((defaultPaise / 100).toFixed(2).replace(/\.00$/, ""));
  const [method, setMethod] = useState("upi");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const paise = parseAmount(amount);
    if (!paise) {
      setError("Enter a valid amount");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await run(
        supabase().rpc("add_settlement", {
          p_group: groupId,
          p_from: from,
          p_to: to,
          p_amount: toRupees(paise),
          p_method: method,
          p_note: note,
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
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Amount (₹)" hint="Change it for a part payment">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Paid by">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note / UPI reference (optional)" maxLength={200} />
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving…" : "Save payment"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PaymentHistory({ data, me, names, reload }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function undo(id: string) {
    if (!confirm("Remove this payment? Balances will go back to before it was recorded.")) return;
    setBusyId(id);
    setError(null);
    try {
      await run(supabase().rpc("delete_settlement", { p_id: id }));
      reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  if (data.settlements.length === 0) return <Empty title="No payments recorded yet" />;

  return (
    <>
      <ErrorText>{error}</ErrorText>
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {data.settlements.map((s) => {
          const method = PAYMENT_METHODS.find((m) => m.key === s.method)?.label ?? s.method;
          return (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="text-lg">💸</span>
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-medium">{names.name(s.from_user)}</span>
                  <span className="text-slate-500"> paid </span>
                  <span className="font-medium">{names.obj(s.to_user)}</span>
                </p>
                <p className="truncate text-xs text-slate-500">
                  {formatDay(s.created_at)} · {method}
                  {s.note ? ` · ${s.note}` : ""}
                </p>
              </div>
              <div className="text-right">
                <Money paise={toPaise(s.amount)} tone="plain" />
                {(s.from_user === me || s.to_user === me) && (
                  <button
                    onClick={() => undo(s.id)}
                    disabled={busyId === s.id}
                    className="block text-xs text-rose-600 hover:underline disabled:text-rose-300"
                  >
                    Undo
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
