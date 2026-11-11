"use client";

import { useState } from "react";
import { Button, ErrorText, Field, Input, Select } from "@/components/ui";
import { errorMessage, run, supabase } from "@/lib/supabase";
import type { Card } from "@/lib/types";

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export function CardForm({ card, onDone }: { card?: Card; onDone: (saved: boolean) => void }) {
  const [nickname, setNickname] = useState(card?.nickname ?? "");
  const [bank, setBank] = useState(card?.bank_name ?? "");
  const [lastFour, setLastFour] = useState(card?.last_four ?? "");
  const [billingDay, setBillingDay] = useState(card?.billing_day ? String(card.billing_day) : "");
  const [dueDay, setDueDay] = useState(card?.due_day ? String(card.due_day) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(lastFour)) return setError("Enter only the last 4 digits of the card");
    setBusy(true);
    setError(null);
    const values = {
      nickname: nickname.trim(),
      bank_name: bank.trim(),
      last_four: lastFour,
      billing_day: billingDay ? Number(billingDay) : null,
      due_day: dueDay ? Number(dueDay) : null,
    };
    try {
      if (card) await run(supabase().from("cards").update(values).eq("id", card.id));
      else await run(supabase().from("cards").insert(values));
      onDone(true);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <p className="font-semibold text-slate-900">{card ? "Edit card" : "Add a credit card"}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nickname">
          <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="HDFC Millennia" required maxLength={40} />
        </Field>
        <Field label="Bank">
          <Input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="HDFC Bank" maxLength={40} />
        </Field>
      </div>
      <Field label="Last 4 digits" hint="Never enter the full card number, CVV, PIN or OTP.">
        <Input
          value={lastFour}
          onChange={(e) => setLastFour(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          placeholder="1234"
          required
          className="font-mono tracking-widest"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Statement day" hint="Day the bill is generated">
          <Select value={billingDay} onChange={(e) => setBillingDay(e.target.value)}>
            <option value="">Not set</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due day" hint="Last day to pay the bill">
          <Select value={dueDay} onChange={(e) => setDueDay(e.target.value)}>
            <option value="">Not set</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : card ? "Save card" : "Add card"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
