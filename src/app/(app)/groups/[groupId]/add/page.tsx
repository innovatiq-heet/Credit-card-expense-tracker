"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useUserId } from "@/components/AuthProvider";
import { ErrorText, Spinner } from "@/components/ui";
import { loadGroupBasics } from "@/lib/groupData";
import { run, supabase } from "@/lib/supabase";
import type { Txn } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { ExpenseForm } from "./ExpenseForm";

async function load(groupId: string, editId: string | null) {
  const [basics, txn] = await Promise.all([
    loadGroupBasics(groupId),
    editId
      ? run<Txn | null>(
          supabase()
            .from("transactions")
            .select("*, transaction_splits(user_id, amount)")
            .eq("id", editId)
            .eq("is_deleted", false)
            .maybeSingle(),
        )
      : Promise.resolve(null),
  ]);
  if (editId && !txn) throw new Error("This expense no longer exists.");
  return { basics, txn };
}

export default function AddExpensePage() {
  const { groupId } = useParams<{ groupId: string }>();
  const editId = useSearchParams().get("edit");
  const me = useUserId();
  const { data, error } = useAsync(() => load(groupId, editId), `${groupId}/${editId ?? "new"}`);
  // Bumped after each save so the next visit starts with an empty form.
  const [formVersion, setFormVersion] = useState(0);

  return (
    <div>
      <Link href={`/groups/${groupId}`} className="text-sm text-indigo-600">
        ← {data?.basics.group.name ?? "Back"}
      </Link>
      <h1 className="mb-4 mt-1 text-2xl font-bold text-slate-900">{editId ? "Edit expense" : "Add expense"}</h1>
      {!data ? (
        error ? <ErrorText>{error}</ErrorText> : <Spinner />
      ) : (
        <ExpenseForm
          key={`${editId ?? "new"}-${formVersion}`}
          basics={data.basics}
          existing={data.txn}
          me={me}
          onSaved={() => setFormVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
