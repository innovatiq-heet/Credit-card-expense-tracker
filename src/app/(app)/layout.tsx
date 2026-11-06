import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { Spinner } from "@/components/ui";

// Everything inside (app) needs a signed-in user. Pages read the URL
// (params / search params) on the client, so they render inside Suspense.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Spinner />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
