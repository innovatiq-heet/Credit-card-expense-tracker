"use client"; // Error boundaries must be Client Components

import { ErrorScreen } from "@/components/ErrorScreen";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
