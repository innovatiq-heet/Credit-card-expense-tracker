"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ActivityList } from "@/components/ActivityList";
import { useUserId } from "@/components/AuthProvider";
import { cx, ErrorText, LinkButton, PageHeader, Spinner } from "@/components/ui";
import { loadGroup, namer } from "@/lib/groupData";
import { useAsync } from "@/lib/useAsync";
import { BalancesTab } from "./BalancesTab";
import { ExpensesTab } from "./ExpensesTab";
import { MembersTab } from "./MembersTab";

const TABS = [
  { key: "expenses", label: "Expenses" },
  { key: "balances", label: "Balances" },
  { key: "members", label: "Members" },
  { key: "activity", label: "Activity" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const me = useUserId();
  const { data, error, loading, reload } = useAsync(() => loadGroup(groupId), groupId);

  const requested = search.get("tab");
  const tab: Tab = TABS.some((t) => t.key === requested) ? (requested as Tab) : "expenses";

  if (!data) {
    return error ? (
      <div className="space-y-3">
        <ErrorText>{error}</ErrorText>
        <Link href="/groups" className="text-sm text-indigo-600">
          ← Back to groups
        </Link>
      </div>
    ) : (
      <Spinner />
    );
  }

  const names = namer(data.members, me);

  return (
    <div className="pb-16 sm:pb-0">
      <PageHeader
        title={data.group.name}
        subtitle={`${data.activeMembers.length} members · ${data.sharedCards.length} shared cards`}
        action={
          <div className="hidden shrink-0 sm:block">
            <LinkButton href={`/groups/${groupId}/add`} className="py-2.5">
              + Add expense
            </LinkButton>
          </div>
        }
      />

      {/* Phones: floating button above the bottom navigation */}
      <Link
        href={`/groups/${groupId}/add`}
        className="fixed bottom-20 right-4 z-30 rounded-full bg-indigo-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 sm:hidden"
      >
        + Add expense
      </Link>

      <div className="sticky top-14 z-10 -mx-4 mb-4 border-b border-slate-200 bg-slate-50/95 px-4 backdrop-blur">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => router.replace(`/groups/${groupId}?tab=${t.key}`, { scroll: false })}
              className={cx(
                "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium",
                tab === t.key ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              {t.label}
            </button>
          ))}
          {loading && <span className="ml-auto self-center text-xs text-slate-400">Refreshing…</span>}
        </div>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {tab === "expenses" && <ExpensesTab data={data} me={me} names={names} reload={reload} />}
      {tab === "balances" && <BalancesTab data={data} me={me} names={names} reload={reload} />}
      {tab === "members" && <MembersTab data={data} me={me} names={names} reload={reload} />}
      {tab === "activity" && <ActivityList items={data.activity} nameOf={names.name} />}
    </div>
  );
}
