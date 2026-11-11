"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ErrorText, Spinner } from "@/components/ui";
import { loadGroupBasics } from "@/lib/groupData";
import { run, supabase } from "@/lib/supabase";
import type { Expense } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { ExpenseForm } from "./ExpenseForm";

async function load(groupId: string, editId: string | null) {
  const [basics, expense] = await Promise.all([
    loadGroupBasics(groupId),
    editId
      ? run<Expense | null>(
          supabase().from("expenses").select("*, expense_shares(person_id, amount)").eq("id", editId).maybeSingle(),
        )
      : Promise.resolve(null),
  ]);
  if (editId && !expense) throw new Error("This expense no longer exists.");
  return { basics, expense };
}

export default function AddExpensePage() {
  const { groupId } = useParams<{ groupId: string }>();
  const editId = useSearchParams().get("edit");
  // Changes on every in-app visit (link click / router.push), so the form starts
  // fresh each time instead of showing an abandoned draft. Browser Back keeps it.
  const { bfcacheId } = useRouter();
  const { data, error, loading, reload } = useAsync(() => load(groupId, editId), `${groupId}/${editId ?? "new"}`);
  // Bumped after each save so the next visit starts with a fresh form.
  const [formVersion, setFormVersion] = useState(0);

  return (
    <div>
      <Link href={`/groups/${groupId}`} className="text-sm text-indigo-600">
        ← {data?.basics.group.name ?? "Back"}
      </Link>
      <h1 className="mb-4 mt-1 text-2xl font-bold text-slate-900">{editId ? "Edit expense" : "Add expense"}</h1>
      {!data || loading ? (
        error ? <ErrorText>{error}</ErrorText> : <Spinner />
      ) : (
        // Next.js keeps this page mounted (hidden) after you leave it, so the form is
        // re-created on each visit and whenever the saved expense changes.
        <ExpenseForm
          key={`${bfcacheId}-${editId ?? "new"}-${formVersion}-${data.expense?.updated_at ?? ""}`}
          basics={data.basics}
          existing={data.expense}
          onSaved={() => {
            setFormVersion((v) => v + 1);
            reload(); // fetch the saved expense (and any people added in the form)
          }}
        />
      )}
    </div>
  );
}
