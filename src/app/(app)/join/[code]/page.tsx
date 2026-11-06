"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ErrorText, Spinner } from "@/components/ui";
import { run, supabase } from "@/lib/supabase";
import { useAsync } from "@/lib/useAsync";

// Invite link: /join/A1B2C3D4. The login guard sends signed-out visitors to
// sign in first and brings them back here.
export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { error } = useAsync(async () => {
    const groupId = await run<string>(supabase().rpc("join_group", { p_code: code }));
    router.replace(`/groups/${groupId}`);
    return groupId;
  }, code);

  if (error) {
    return (
      <div className="space-y-3">
        <ErrorText>{error}</ErrorText>
        <Link href="/groups" className="text-sm text-indigo-600">
          Go to groups
        </Link>
      </div>
    );
  }
  return <Spinner label="Joining group…" />;
}
