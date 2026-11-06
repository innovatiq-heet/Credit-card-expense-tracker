"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Button, ErrorText, Field, Input, PageHeader, Panel, Spinner } from "@/components/ui";
import { errorMessage, run, supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

export default function ProfilePage() {
  const { profile, signOut } = useAuth();
  if (!profile) return <Spinner />;
  return (
    <div>
      <PageHeader title="Profile" />
      <ProfileForm key={profile.id} profile={profile} />
      <Panel className="mt-4">
        <Button variant="secondary" onClick={() => signOut()}>
          Sign out
        </Button>
      </Panel>
    </div>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const { refreshProfile } = useAuth();
  const [name, setName] = useState(profile.full_name);
  const [upi, setUpi] = useState(profile.upi_id ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const upiId = upi.trim();
    if (upiId && !/^[A-Za-z0-9._-]{2,200}@[A-Za-z0-9.-]{2,64}$/.test(upiId)) {
      return setError("UPI ID looks wrong. It should look like name@okhdfcbank");
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await run(
        supabase()
          .from("profiles")
          .update({ full_name: name.trim(), upi_id: upiId || null })
          .eq("id", profile.id),
      );
      await refreshProfile();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <form onSubmit={save} className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        </Field>
        <Field label="Email">
          <Input value={profile.email ?? ""} disabled />
        </Field>
        <Field label="UPI ID" hint="Friends get a one-tap “Pay via UPI” button when they owe you.">
          <Input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="yourname@okhdfcbank" autoCapitalize="none" />
        </Field>
        <ErrorText>{error}</ErrorText>
        {saved && <p className="text-sm text-emerald-600">Saved ✓</p>}
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>
    </Panel>
  );
}
