"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ConfigProblem } from "@/components/ConfigProblem";
import { Button, ErrorText, Field, Input, Panel } from "@/components/ui";
import { errorMessage, supabase } from "@/lib/supabase";

type Mode = "signIn" | "signUp" | "forgot";

export function LoginForm() {
  const { status, problem } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const [mode, setMode] = useState<Mode>("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (status === "signedIn") router.replace(target);
  }, [status, target, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const auth = supabase().auth;
      if (mode === "signIn") {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signUp") {
        const { data, error } = await auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: `${window.location.origin}${target}`,
          },
        });
        if (error) throw error;
        if (!data.session) setInfo("Account created! Check your email to confirm it, then sign in.");
      } else {
        const { error } = await auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setInfo("If that email has an account, a reset link is on its way.");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (status === "unconfigured") return <ConfigProblem problem={problem} />;

  return (
    <Panel className="p-6">
      <h1 className="text-xl font-bold text-slate-900">
        {mode === "signIn" ? "Welcome back" : mode === "signUp" ? "Create your account" : "Reset password"}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {mode === "signUp"
          ? "Track who used whose card and who owes whom."
          : mode === "forgot"
            ? "We'll email you a link to set a new password."
            : "Sign in to see your groups and balances."}
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {mode === "signUp" && (
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Heet" autoComplete="name" />
          </Field>
        )}
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        {mode !== "forgot" && (
          <Field label="Password" hint={mode === "signUp" ? "At least 6 characters" : undefined}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === "signUp" ? "new-password" : "current-password"}
            />
          </Field>
        )}

        <ErrorText>{error}</ErrorText>
        {info && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</p>}

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Please wait…" : mode === "signIn" ? "Sign in" : mode === "signUp" ? "Create account" : "Send reset link"}
        </Button>
      </form>

      <div className="mt-5 space-y-2 text-center text-sm">
        {mode === "signIn" ? (
          <>
            <button className="text-indigo-600 hover:underline" onClick={() => setMode("signUp")}>
              New here? Create an account
            </button>
            <br />
            <button className="text-slate-500 hover:underline" onClick={() => setMode("forgot")}>
              Forgot password?
            </button>
          </>
        ) : (
          <button className="text-indigo-600 hover:underline" onClick={() => setMode("signIn")}>
            Already have an account? Sign in
          </button>
        )}
      </div>
    </Panel>
  );
}
