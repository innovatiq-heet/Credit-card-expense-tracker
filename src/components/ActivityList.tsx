"use client";

import { timeAgo } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import type { Activity } from "@/lib/types";
import { Avatar, Empty } from "./ui";

function describe(a: Activity): string {
  const amount = a.amount != null ? ` · ${formatINR(a.amount)}` : "";
  switch (a.action) {
    case "group_created":
      return `created the group “${a.label}”`;
    case "member_joined":
      return "joined the group";
    case "member_left":
      return "left the group";
    case "transaction_added":
      return `added “${a.label}”${amount}`;
    case "transaction_edited":
      return `edited “${a.label}”${amount}`;
    case "transaction_deleted":
      return `deleted “${a.label}”${amount}`;
    case "settlement_added":
      return `recorded a payment ${a.label}${amount}`;
    case "settlement_deleted":
      return `removed a payment ${a.label}${amount}`;
    case "card_shared":
      return `shared card ${a.label}`;
    case "card_unshared":
      return `stopped sharing card ${a.label}`;
    default:
      return a.action;
  }
}

export function ActivityList({
  items,
  nameOf,
  groupNameOf,
}: {
  items: Activity[];
  nameOf: (id: string | null) => string;
  groupNameOf?: (groupId: string) => string | undefined;
}) {
  if (items.length === 0) return <Empty title="No activity yet" />;
  return (
    <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
      {items.map((a) => {
        const actor = nameOf(a.actor_id);
        const group = groupNameOf?.(a.group_id);
        return (
          <li key={a.id} className="flex items-start gap-3 px-4 py-3">
            <Avatar name={actor} id={a.actor_id ?? undefined} size="sm" />
            <div className="min-w-0 text-sm">
              <p className="text-slate-800">
                <span className="font-medium">{actor}</span> {describe(a)}
              </p>
              <p className="text-xs text-slate-500">
                {timeAgo(a.created_at)}
                {group ? ` · ${group}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
