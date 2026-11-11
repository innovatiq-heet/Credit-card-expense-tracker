# CardMates

A personal tracker for **money you paid for other people**: make a group, add the people, add what you paid, and see who owes you how much.

Built with Next.js + Tailwind CSS on the front end and **Supabase** (Postgres, Auth, Row Level Security) as the backend.

## What it does

Only you sign in. Friends are just names in a group – they don't need an account.

| | |
|---|---|
| **Groups** | One per trip, flat, office… Each has its own people and expenses. |
| **People** | Add a name (and optionally a WhatsApp number). You can also add a new person right inside the add-expense form. |
| **Expenses** | Amount, what, date, category, how you paid (one of your cards or cash/UPI) and who shares it – split equally or by exact amounts. The form shows how much you will get back. |
| **Who owes you** | Per person: what they owe, what they already paid, and what is left. Home shows the total to collect across all groups. |
| **Collecting** | “Remind on WhatsApp” opens the person's chat with the amount, the list of items and your UPI ID. “Received money” records a full or part payment; a wrong one can be undone. |
| **Cards** (optional) | Your cards (**last 4 digits only**, statement day, due day). Each shows what you charged this billing cycle and how much of it is other people's. |
| **Summary** | Per group: total paid, your share, others' share, by category and by card, with month and card filters. |

### Money rules (enforced in the database)
- Every expense is paid by you. Your own share is never a debt.
- An expense's shares must add up **exactly** to the amount (₹100 ÷ 3 = 33.34 + 33.33 + 33.33).
- A person's balance = their shares − what they paid you.
- A person who is part of an expense can't be removed (delete or edit the expense first).
- Full card numbers, CVV, PIN and OTP are never stored (the database rejects anything but 4 digits).
- Row Level Security: an account can only ever read or change its own data.

## Set up Supabase (one time)

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query →** paste the whole of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   ⚠ The file starts by removing earlier CardMates tables, so it also upgrades a project that has the old multi-user version. Any data in those tables is deleted.
3. **Authentication → URL Configuration:** set *Site URL* to where the app runs (e.g. your Netlify/Vercel URL) and add `https://your-site/**` and `http://localhost:3000/**` under *Redirect URLs*.
4. Optional: **Authentication → Sign In / Providers → Email →** turn off *Confirm email* to sign in right after signing up.
5. After you have created your own account, you can turn off **Allow new users to sign up** (Authentication → Sign In / Providers) so nobody else can register on your site. (Even if they do, they can't see your data.)
6. **Project Settings → API Keys** (or the **Connect** button): copy the *Project URL* and the *publishable / anon* key.

## Run locally

```bash
npm install
cp .env.example .env.local   # paste the URL and key from step 6
npm run dev                  # http://localhost:3000
```

## Deploy (Netlify or Vercel)

Import the GitHub repo, add the two `NEXT_PUBLIC_SUPABASE_*` environment variables (value only – no quotes, no `NAME=`), deploy. The values are built into the site, so redeploy after changing them.

## Tests

```bash
npm test          # money maths, billing cycle, settings parsing, WhatsApp links
npm run test:db   # runs schema.sql on a throwaway local Postgres and checks
                  # balances, rounding, validation and RLS (needs psql + a local Postgres)
npm run lint && npm run typecheck && npm run build
```

## Project layout

```
supabase/schema.sql          the whole database: tables, RLS, balances view, save_expense()
supabase/tests/              database tests (local Postgres only)
src/app/login                sign in / sign up / forgot password
src/app/(app)/               signed-in pages
  page.tsx                   home: total to collect, who owes you, groups
  groups/                    list + create
  groups/[groupId]/          Expenses tab · People & balances tab
  groups/[groupId]/add/      add / edit expense
  cards/                     your cards and this cycle's charges
  profile/                   name, UPI ID, sign out
src/lib/                     Supabase client, money (paise) maths, dates, types
```

## History

Version 1 was a multi-user app (every friend had an account, cards were shared between friends). It was simplified to this personal version; [`docs/blueprint-review.md`](docs/blueprint-review.md) is the original design review and no longer describes the app.
