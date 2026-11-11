"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { cx, ErrorText, LinkButton, PageHeader, Spinner } from "@/components/ui";
import { loadGroup, namer } from "@/lib/groupData";
import { formatPaise, toPaise } from "@/lib/money";
import { useAsync } from "@/lib/useAsync";
import { ExpensesTab } from "./ExpensesTab";
import { PeopleTab } from "./PeopleTab";

const TABS = [
  { key: "expenses", label: "Expenses" },
  { key: "people", label: "People & balances" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const search = useSearchParams();
  const router = useRouter();
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

  const names = namer(data.people);
  const toCollect = data.balances.reduce((sum, b) => sum + Math.max(0, toPaise(b.balance)), 0);

  return (
    <div className="pb-16 sm:pb-0">
      <PageHeader
        title={data.group.name}
        subtitle={
          toCollect > 0 ? (
            <>
              To collect: <span className="font-semibold text-emerald-600">{formatPaise(toCollect)}</span>
            </>
          ) : (
            `${data.people.length} ${data.people.length === 1 ? "person" : "people"} · all settled`
          )
        }
        action={
          <div className="hidden shrink-0 sm:block">
            <LinkButton href={`/groups/${groupId}/add`} className="py-2.5">
              + Add expense
            </LinkButton>
          </div>
        }
      />

      {/* Phones: floating button just above the floating tab bar */}
      <Link
        href={`/groups/${groupId}/add`}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)_+_5.75rem)] right-4 z-30 rounded-full bg-indigo-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 sm:hidden"
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

      {tab === "expenses" && <ExpensesTab data={data} names={names} reload={reload} />}
      {tab === "people" && <PeopleTab data={data} names={names} reload={reload} />}
    </div>
  );
}
