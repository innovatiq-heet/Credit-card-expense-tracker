"use client";

import type { User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { errorMessage, isSupabaseConfigured, supabase, supabaseConfigProblem } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

type AuthState = {
  status: "loading" | "signedOut" | "signedIn" | "unconfigured";
  /** When status is "unconfigured": what is wrong with the Supabase settings. */
  problem: string | null;
  user: User | null;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>(isSupabaseConfigured ? "loading" : "unconfigured");
  const [problem, setProblem] = useState<string | null>(supabaseConfigProblem);

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase()
      .from("profiles")
      .select("id, full_name, email, upi_id")
      .eq("id", userId)
      .maybeSingle();
    setProfile(data as Profile | null);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let client: ReturnType<typeof supabase>;
    try {
      client = supabase();
    } catch (e) {
      // Never crash the whole app over bad settings – show what is wrong instead.
      queueMicrotask(() => {
        setProblem(errorMessage(e));
        setStatus("unconfigured");
      });
      return;
    }

    const apply = (next: User | null) => {
      setUser(next);
      setStatus(next ? "signedIn" : "signedOut");
      if (next) void loadProfile(next.id);
      else setProfile(null);
    };

    client.auth.getSession().then(({ data }) => apply(data.session?.user ?? null));
    const { data } = client.auth.onAuthStateChange((_event, session) => apply(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  const signOut = useCallback(async () => {
    await supabase().auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ status, problem, user, profile, refreshProfile, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** For pages behind the login guard: the signed-in user's id. */
export function useUserId(): string {
  const { user } = useAuth();
  return user?.id ?? "";
}
