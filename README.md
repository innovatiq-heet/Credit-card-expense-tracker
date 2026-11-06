# CardMates

Shared credit card expenses for friends: **whose card was used, who bought what, and who owes whom.**

Built with Next.js + Tailwind CSS on the front end and **Supabase** (Postgres, Auth, Row Level Security) as the backend.

## What it does

| | |
|---|---|
| **Groups** | Create a group (e.g. “Ahmedabad Friends”), invite friends with a code / link / WhatsApp. |
| **Cards** | Each person adds their own cards (nickname, bank, **last 4 digits only**, statement day, due day) and chooses which groups can use them. |
| **Expenses** | Record a purchase: amount, what, date, category, which card (or cash/UPI), who bought it (or “unknown”), and who pays for it – split equally or by exact amounts. |
| **Balances** | Money is owed to the person whose card/cash was used. Debts between two people are netted, so you see one clear “Amit owes Heet ₹4,000”. |
| **Settle up** | “Pay via UPI” button (opens GPay / PhonePe / Paytm), “Remind on WhatsApp”, record full or part payments, undo a wrong one. |
| **Card cycle** | For your cards: what was charged this billing cycle, how much of it is each friend’s, and when the bill is due. |
| **Reports** | Per group: total spent, your share, spend by category and by card, filter by month and card. |
| **Activity** | Who added, edited or deleted what – nothing is silently changed. |

### Money rules (enforced in the database)
- A card belongs to one person. Charges on it are paid by that person until friends settle up.
- Every expense’s shares must add up **exactly** to the amount (₹100 ÷ 3 = 33.34 + 33.33 + 33.33).
- Only the person who added an expense, or the card owner / payer, can edit or delete it. Deleting is a soft delete – history is kept.
- A payment can only be recorded by the payer or the receiver; either of them can undo it.
- You can only leave a group when your balance in it is zero.
- Full card numbers, CVV, PIN and OTP are never stored (the database rejects anything but 4 digits).

## Set up Supabase (one time)

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query →** paste the whole of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. **Authentication → URL Configuration:** set *Site URL* to where the app runs (e.g. `http://localhost:3000`, later your Vercel URL) and add the same URL under *Redirect URLs*.
4. Optional, for a friends-only app: **Authentication → Sign In / Providers → Email →** turn off *Confirm email* so friends can sign in right after signing up. If you keep it on, they click the link in their email first.
5. **Project Settings → API** (or the **Connect** button): copy the *Project URL* and the *anon / publishable* key.

## Run locally

```bash
npm install
cp .env.example .env.local   # paste the URL and anon key from step 5
npm run dev                  # http://localhost:3000
```

## Deploy (Vercel)

Import the GitHub repo in Vercel, add the two `NEXT_PUBLIC_SUPABASE_*` environment variables, deploy, then put the Vercel URL into Supabase *Site URL* / *Redirect URLs*.

## Tests

```bash
npm test          # money maths + billing cycle (Node test runner)
npm run test:db   # runs schema.sql on a throwaway local Postgres and checks
                  # balances, rounding, permissions and RLS (needs psql + a local Postgres)
npm run lint && npm run typecheck && npm run build
```

## Project layout

```
supabase/schema.sql          the whole database: tables, RLS, functions – run this in Supabase
supabase/tests/              database tests (local Postgres only)
src/app/login                sign in / sign up / forgot password
src/app/(app)/               signed-in pages
  page.tsx                   home: you'll get / you owe, settle-up list, activity
  groups/                    list, create, join
  groups/[groupId]/          expenses · balances · members · activity tabs
  groups/[groupId]/add/      add / edit expense
  cards/                     my cards, sharing, billing cycle; friends' cards
  profile/                   name, UPI ID, sign out
  join/[code]/               invite link
src/lib/                     Supabase client, money (paise) maths, dates, types
```

All reads go through Supabase with Row Level Security (you only ever see groups you belong to). All money writes go through Postgres functions (`save_transaction`, `add_settlement`, …) that check permissions and validate totals in one database transaction.

## Not in this version (on purpose)

EMI conversions, statement upload, receipt photos, multi-currency, debt simplification across people, push notifications. See [`docs/blueprint-review.md`](docs/blueprint-review.md) for ideas for later.
