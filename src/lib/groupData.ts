import { run, supabase } from "./supabase";
import type { Card, Expense, Group, Payment, Person, PersonBalance } from "./types";

/** Group, its people and your cards. */
export async function loadGroupBasics(groupId: string) {
  const db = supabase();
  const [group, people, cards] = await Promise.all([
    run<Group | null>(db.from("groups").select("*").eq("id", groupId).maybeSingle()),
    run<Person[]>(db.from("people").select("*").eq("group_id", groupId).order("created_at")),
    run<Card[]>(db.from("cards").select("*").order("created_at")),
  ]);
  if (!group) throw new Error("Group not found.");
  return {
    group,
    people,
    cards: new Map(cards.map((c) => [c.id, c])),
    activeCards: cards.filter((c) => c.is_active),
  };
}

export type GroupBasics = Awaited<ReturnType<typeof loadGroupBasics>>;

/** Everything the group page shows. */
export async function loadGroup(groupId: string) {
  const db = supabase();
  const [basics, expenses, payments, balances] = await Promise.all([
    loadGroupBasics(groupId),
    run<Expense[]>(
      db
        .from("expenses")
        .select("*, expense_shares(person_id, amount)")
        .eq("group_id", groupId)
        .order("txn_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2000),
    ),
    run<Payment[]>(
      db
        .from("payments")
        .select("*")
        .eq("group_id", groupId)
        .order("paid_on", { ascending: false })
        .order("created_at", { ascending: false }),
    ),
    run<PersonBalance[]>(db.from("person_balances").select("*").eq("group_id", groupId)),
  ]);
  return { ...basics, expenses, payments, balances };
}

export type GroupData = Awaited<ReturnType<typeof loadGroup>>;

/** Name helpers for one group. person id null = you. */
export function namer(people: Person[]) {
  const byId = new Map(people.map((p) => [p.id, p]));
  return {
    name: (id: string | null) => (id === null ? "You" : (byId.get(id)?.name ?? "Removed person")),
    /** Lowercase "you" for the middle of a sentence. */
    obj: (id: string | null) => (id === null ? "you" : (byId.get(id)?.name ?? "removed person")),
    person: (id: string) => byId.get(id) ?? null,
    card: (card: Card | undefined) => (card ? `${card.nickname} ••${card.last_four}` : "Card"),
  };
}

export type Names = ReturnType<typeof namer>;
