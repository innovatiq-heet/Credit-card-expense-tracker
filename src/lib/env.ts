// Reads the two Supabase settings and forgives common copy-paste mistakes:
// quotes, a "NAME=" prefix, both lines pasted into one variable, a trailing
// /rest/v1/ path, or a missing https://. Pure functions (no imports) so they
// can be unit-tested with plain Node.

/** Pull "https://<project>.supabase.co" out of whatever was pasted. */
export function cleanSupabaseUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const withScheme = raw.match(/https?:\/\/[A-Za-z0-9.-]+(?::\d+)?/);
  if (withScheme) return withScheme[0].replace(/\.+$/, "");
  const bareHost = raw.match(/\b([A-Za-z0-9-]+\.supabase\.co)\b/);
  return bareHost ? `https://${bareHost[1].toLowerCase()}` : null;
}

const PUBLIC_KEY = /sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

/** True if a JWT-style key is the service_role key (must never be in a website). */
function isServiceRoleJwt(key: string): boolean {
  if (!key.startsWith("eyJ")) return false;
  try {
    const payload = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).role === "service_role";
  } catch {
    return false;
  }
}

/**
 * The publishable / anon key: found in the key variable, or in the URL variable
 * if both lines were pasted there. A key in a format we don't recognise is used
 * as typed (minus quotes and a "NAME=" prefix) rather than refused.
 */
export function cleanSupabaseKey(rawKey: string | undefined, rawUrl?: string): string | null {
  for (const raw of [rawKey, rawUrl]) {
    const match = raw?.match(PUBLIC_KEY);
    if (match) return match[0];
  }
  const asTyped = rawKey
    ?.trim()
    .replace(/^[A-Z_]+\s*=\s*/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  return asTyped || null;
}

export type SupabaseConfig = { url: string; key: string; problem: null } | { url: null; key: null; problem: string };

export function readSupabaseConfig(rawUrl: string | undefined, rawKey: string | undefined): SupabaseConfig {
  if (!rawUrl?.trim() && !rawKey?.trim()) {
    return { url: null, key: null, problem: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set." };
  }
  if (/sb_secret_/.test(`${rawUrl} ${rawKey}`)) {
    return {
      url: null,
      key: null,
      problem: "A Supabase SECRET key was used. Use the publishable (anon) key instead – secret keys must never be put in a website.",
    };
  }
  const url = cleanSupabaseUrl(rawUrl);
  if (!url) {
    return {
      url: null,
      key: null,
      problem: "NEXT_PUBLIC_SUPABASE_URL is not a valid address. It should look like https://your-project.supabase.co",
    };
  }
  // The key may also have been pasted into the URL variable by mistake.
  const key = cleanSupabaseKey(rawKey, rawUrl);
  if (!key) {
    return {
      url: null,
      key: null,
      problem: "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. Use the publishable key (sb_publishable_…) or the anon key (eyJ…).",
    };
  }
  if (isServiceRoleJwt(key)) {
    return {
      url: null,
      key: null,
      problem: "The service_role key was used. Use the anon (public) key instead – service_role must never be put in a website.",
    };
  }
  return { url, key, problem: null };
}
