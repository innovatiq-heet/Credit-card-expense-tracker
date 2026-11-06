import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center justify-center gap-2 text-2xl font-bold text-slate-900">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-base text-white">CM</span>
        CardMates
      </div>
      <Suspense fallback={<Spinner />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
