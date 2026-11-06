"use client";

/** Shown instead of the app when the Supabase settings are missing or wrong. */
export function ConfigProblem({ problem }: { problem: string | null }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
      <h1 className="text-lg font-bold">CardMates can&apos;t connect to Supabase</h1>
      <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 font-medium">{problem ?? "Supabase settings are missing."}</p>
      <p className="mt-3 font-medium">How to fix it</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5">
        <li>
          Set exactly these two variables (no quotes, no spaces, nothing else in the value):
          <pre className="mt-1 whitespace-pre-wrap break-all rounded-lg bg-white/70 p-2 text-xs">
            {"NEXT_PUBLIC_SUPABASE_URL = https://your-project.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY = sb_publishable_…"}
          </pre>
        </li>
        <li>
          <b>Netlify / Vercel:</b> in the site&apos;s Environment variables, then redeploy with the build cache cleared
          (the values are built into the site).
        </li>
        <li>
          <b>On your computer:</b> in <code>.env.local</code>, then restart <code>npm run dev</code>.
        </li>
      </ol>
    </div>
  );
}
