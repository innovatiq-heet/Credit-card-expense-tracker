"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Button, ErrorText, Field, Input, Panel, Spinner } from "@/components/ui";
import { errorMessage, supabase } from "@/lib/supabase";

// Opened from the "reset password" email. Supabase signs the user in from the
// link, then they choose a new password here.
export default function ResetPasswordPage() {
  const { status } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase().auth.updateUser({ password });
      if (error) throw error;
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      {status === "loading" ? (
        <Spinner />
      ) : status !== "signedIn" ? (
        <Panel>
          <p className="text-sm text-slate-600">This reset link is invalid or has expired. Request a new one from the sign-in page.</p>
        </Panel>
      ) : (
        <Panel className="p-6">
          <h1 className="text-xl font-bold text-slate-900">Choose a new password</h1>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field label="New password" hint="At least 6 characters">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
            </Field>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Saving…" : "Save password"}
            </Button>
          </form>
        </Panel>
      )}
    </div>
  );
}
