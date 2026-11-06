"use client"; // Error boundaries must be Client Components

import { ErrorScreen } from "@/components/ErrorScreen";
import "./globals.css";

// Replaces the root layout when even it fails, so it needs its own <html>/<body>.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-slate-50 antialiased">
        <title>CardMates – error</title>
        <ErrorScreen error={error} retry={retry} />
      </body>
    </html>
  );
}
