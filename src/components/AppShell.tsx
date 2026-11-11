"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { ConfigProblem } from "./ConfigProblem";
import { CardIcon, GroupsIcon, HomeIcon, ProfileIcon } from "./icons";
import { cx, Spinner } from "./ui";

const NAV = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/groups", label: "Groups", Icon: GroupsIcon },
  { href: "/cards", label: "Cards", Icon: CardIcon },
  { href: "/profile", label: "Profile", Icon: ProfileIcon },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Login guard + navigation for every signed-in page. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, problem } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === "signedOut") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, pathname, router]);

  if (status === "unconfigured") return <SetupNotice problem={problem} />;
  if (status !== "signedIn") return <Spinner />;

  return (
    // Bottom padding on phones keeps content clear of the floating tab bar.
    <div className="min-h-dvh pb-[calc(env(safe-area-inset-bottom)_+_6rem)] md:pb-0">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm text-white">CM</span>
            CardMates
          </Link>
          <nav aria-label="Main" className="hidden gap-1 md:flex">
            {NAV.map(({ href, label, Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  <Icon className="h-4 w-4" active={active} />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>

      {/* Phones: floating tab bar above the home indicator */}
      <nav
        aria-label="Main"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)] md:hidden"
      >
        <div className="pointer-events-auto mx-auto grid max-w-md grid-cols-4 gap-1 rounded-2xl border border-slate-200/80 bg-white/85 p-1.5 shadow-[0_8px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          {NAV.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "group flex flex-col items-center gap-0.5 rounded-xl py-1 text-[11px] font-medium tracking-wide transition-colors",
                  active ? "text-indigo-700" : "text-slate-500 hover:text-slate-800",
                )}
              >
                <span
                  className={cx(
                    "flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200",
                    active ? "bg-indigo-100" : "group-hover:bg-slate-100",
                  )}
                >
                  <Icon className="h-[22px] w-[22px]" active={active} />
                </span>
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function SetupNotice({ problem }: { problem: string | null }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <ConfigProblem problem={problem} />
    </div>
  );
}
