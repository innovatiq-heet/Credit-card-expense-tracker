"use client";

/**
 * Friendly replacement for Next.js' "This page couldn't load" screen. It shows
 * the actual error message, so a screenshot from a phone is enough to debug.
 */
export function ErrorScreen({ error, retry }: { error: unknown; retry?: () => void }) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "An unexpected error happened.";
  const digest = error && typeof error === "object" && "digest" in error ? String((error as { digest: unknown }).digest) : null;

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-2xl border border-rose-200 bg-white p-6">
        <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">Try again. If it keeps happening, send a screenshot of this message.</p>
        <p className="mt-3 break-words rounded-lg bg-rose-50 px-3 py-2 font-mono text-xs text-rose-800">
          {message}
          {digest ? ` (ref ${digest})` : ""}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {retry && (
            <button
              onClick={() => retry()}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Try again
            </button>
          )}
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Reload page
          </button>
          {/* Full page load on purpose: the in-app router may be what failed. */}
          <button
            onClick={() => window.location.assign(window.location.origin)}
            className="rounded-xl px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
          >
            Home
          </button>
        </div>
      </div>
    </div>
  );
}
