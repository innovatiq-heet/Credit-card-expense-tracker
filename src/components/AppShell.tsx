"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { cx, Spinner } from "./ui";

const NAV = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/groups", label: "Groups", icon: "👥" },
  { href: "/cards", label: "Cards", icon: "💳" },
  { href: "/profile", label: "Profile", icon: "🙂" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Login guard + navigation for every signed-in page. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === "signedOut") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, pathname, router]);

  if (status === "unconfigured") return <SetupNotice />;
  if (status !== "signedIn") return <Spinner />;

  return (
    <div className="min-h-dvh pb-20 md:pb-0">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm text-white">CM</span>
            CardMates
          </Link>
          <nav className="hidden gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cx(
                  "rounded-lg px-3 py-1.5 text-sm font-medium",
                  isActive(pathname, item.href) ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="mx-auto grid max-w-3xl grid-cols-4">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "flex flex-col items-center gap-0.5 py-2 text-xs font-medium",
                isActive(pathname, item.href) ? "text-indigo-700" : "text-slate-500",
              )}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-900">Connect Supabase</h1>
      <p className="mt-2 text-slate-600">CardMates needs a Supabase project. Three steps:</p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-slate-700">
        <li>
          Run <code className="rounded bg-slate-100 px-1">supabase/schema.sql</code> in the Supabase SQL Editor.
        </li>
        <li>
          Copy <code className="rounded bg-slate-100 px-1">.env.example</code> to{" "}
          <code className="rounded bg-slate-100 px-1">.env.local</code> and paste your project URL and anon key.
        </li>
        <li>Restart the dev server.</li>
      </ol>
    </div>
  );
}
