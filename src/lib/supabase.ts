import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseConfig } from "./env";

// Public values – safe to ship to the browser. Security is enforced by
// Row Level Security and the database functions in supabase/schema.sql.
// (Each variable must be written out in full so Next.js can build it in.)
const config = readSupabaseConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** Why Supabase can't be used, in plain words – or null when the settings are fine. */
export const supabaseConfigProblem: string | null = config.problem;
export const isSupabaseConfigured = config.problem === null;

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (config.problem !== null) throw new Error(config.problem);
  if (!client) client = createClient(config.url, config.key);
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
