import { run, supabase } from "./supabase";
import type { Activity, Card, Group, Member, Pair, Settlement, Txn } from "./types";

/** Group, members and the cards this group can use. */
export async function loadGroupBasics(groupId: string) {
  const db = supabase();
  const [group, members, cards, cardGroups] = await Promise.all([
    run<Group | null>(db.from("groups").select("*").eq("id", groupId).maybeSingle()),
    run<Member[]>(
      db
        .from("group_members")
        .select("group_id, user_id, role, is_active, joined_at, profile:profiles(id, full_name, email, upi_id)")
        .eq("group_id", groupId)
        .order("joined_at"),
    ),
    run<Card[]>(db.from("cards").select("*").order("created_at")),
    run<{ card_id: string }[]>(db.from("card_groups").select("card_id").eq("group_id", groupId)),
  ]);
  if (!group) throw new Error("Group not found, or you are not a member of it.");
  const shared = new Set(cardGroups.map((c) => c.card_id));
  return {
    group,
    members,
    activeMembers: members.filter((m) => m.is_active),
    cards: new Map(cards.map((c) => [c.id, c])),
    sharedCards: cards.filter((c) => shared.has(c.id) && c.is_active),
  };
}

export type GroupBasics = Awaited<ReturnType<typeof loadGroupBasics>>;

/** Everything the group page shows. */
export async function loadGroup(groupId: string) {
  const db = supabase();
  const [basics, txns, settlements, pairs, activity] = await Promise.all([
    loadGroupBasics(groupId),
    run<Txn[]>(
      db
        .from("transactions")
        .select("*, transaction_splits(user_id, amount)")
        .eq("group_id", groupId)
        .eq("is_deleted", false)
        .order("txn_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2000),
    ),
    run<Settlement[]>(
      db
        .from("settlements")
        .select("*")
        .eq("group_id", groupId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false }),
    ),
    run<Pair[]>(db.rpc("group_balances", { p_group: groupId })),
    run<Activity[]>(
      db.from("activity").select("*").eq("group_id", groupId).order("created_at", { ascending: false }).limit(50),
    ),
  ]);
  return { ...basics, txns, settlements, pairs, activity };
}

export type GroupData = Awaited<ReturnType<typeof loadGroup>>;

/** Name helpers shared by the group screens. */
export function namer(members: Member[], me: string) {
  const byId = new Map(members.map((m) => [m.user_id, m]));
  const fullName = (id: string | null) => (id ? byId.get(id)?.profile?.full_name || "Former member" : "Unknown");
  return {
    /** "You" for the current user, otherwise the person's name. */
    name: (id: string | null) => (id === me ? "You" : fullName(id)),
    /** Same, but lowercase "you" for the middle of a sentence. */
    obj: (id: string | null) => (id === me ? "you" : fullName(id)),
    fullName,
    profile: (id: string) => byId.get(id)?.profile ?? null,
    /** "Heet's HDFC Millennia ••1234" / "Your HDFC Millennia ••1234" */
    card: (card: Card | undefined) => {
      if (!card) return "Card";
      const owner = card.owner_id === me ? "Your" : `${fullName(card.owner_id)}'s`;
      return `${owner} ${card.nickname} ••${card.last_four}`;
    },
  };
}

export type Names = ReturnType<typeof namer>;
