import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Public values – safe to ship to the browser. Security is enforced by
// Row Level Security and the database functions in supabase/schema.sql.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local",
    );
  }
  if (!client) client = createClient(url, key);
  return client;
}

export type QueryResult = { data?: unknown; error: { message: string } | null };

/**
 * Await a Supabase query and throw a readable Error if it failed.
 * The row type is given by the caller: run<Card[]>(db.from("cards").select("*")).
 */
export async function run<T = unknown>(query: PromiseLike<QueryResult>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}
