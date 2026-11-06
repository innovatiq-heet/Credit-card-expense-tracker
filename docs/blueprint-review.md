# CardMates – Blueprint Review & Recommended Additions

Backend: **Supabase** (Postgres + Auth + Storage + Realtime + Edge Functions).
This document reviews the original CardMates blueprint before development starts.
It lists (A) corrections to make before writing any code, (B) features to add,
(C) schema changes, and (D) a revised build plan.

---

## 0. Core model (one paragraph)

A **card belongs to one person**. Anyone the owner allows can record a charge on
that card inside a group. Each charge is split into **responsibility shares**.
Each share creates a debt: **share holder → card owner**, unless the share holder
is the owner. Settlements reduce those debts. The **purchaser** is recorded so
everyone knows who made the charge, but it does **not** change who owes money.
The money depends only on *whose card was charged* and *who is responsible for which share*.

---

## A. Corrections to make before coding

### A1. Compute balances pair by pair, not just one net number per person
The blueprint's formula `Net = Charged − Responsibility` gives one number per
user. That number cannot say *who owes whom*, and the MVP needs exactly that
("pay the relevant card owner"). Build the engine on a **pairwise ledger**:

```
for each split s of a confirmed transaction t:
    if s.user_id != t.card_owner:
        debt(s.user_id → t.card_owner) += s.amount
for each confirmed settlement p:
    debt(p.from → p.to) -= p.amount
net(A,B) = debt(A→B) − debt(B→A)
```

The per-user net balance is the sum of that user's pairwise amounts, so the
dashboard figure and the "who pays whom" list always agree. Debt simplification
(fewer payments) can be added later on top of this pairwise data.

### A2. Generalise "card owner" to "who paid up front" (`funded_by`)
Groups will also have cash and UPI expenses: dinner paid via UPI, petrol paid in
cash. If the creditor is `funded_by` instead of a hard-wired card owner, one
engine covers both:
- card transaction → `funded_by = card.owner_id`
- cash/UPI expense → `funded_by = payer`, `card_id = NULL`

This costs very little now and prevents a second engine later.

### A3. Refunds, reversals and fees are missing from the schema
The test list includes refunds, but the schema has no way to record one. Add
`transactions.kind`:
`purchase | refund | fee | interest | cashback | emi_installment`
plus `parent_transaction_id`. A refund is a negative-direction entry linked to
the original purchase. By default it is split in the same proportions as the
original (supports partial refunds).

### A4. Store how a split was entered, not just the final amounts
`transaction_splits` only stores amounts. Editing a "percentage" or "equal"
split later then means guessing what the user originally entered. Add
`transactions.split_method` (`single|equal|exact|percentage|shares`) and
`transaction_splits.share_value` (the percent or share count). Amounts are still
the source of truth for balances.

**Rounding rule (deterministic):** compute in paise (integer), floor every
share, then give the leftover paise one at a time to participants in a stable
order (e.g. by `user_id`). ₹100 / 3 → 33.34, 33.33, 33.33. Never use JS
floating-point for money: the frontend should work in integer paise or with a
decimal library.

### A5. Define exactly what counts toward balances
| Transaction status | Counts toward balances? |
|---|---|
| `pending` | Shown as *provisional*, not settleable |
| `confirmed` | Yes |
| `disputed` | No (frozen until resolved) |
| `unassigned` | No |
| `cancelled` | No |

Settlements count **only after the receiver confirms** (`pending → paid`).
Otherwise anyone could mark a debt as paid on their own.

### A6. Put atomic writes in Postgres RPC functions, not Edge Functions
Creating a transaction together with its splits must be one database
transaction. Through supabase-js, every call from an Edge Function is a separate
HTTP request, so it **cannot** wrap several inserts atomically. Use:
- **Postgres functions (`rpc`)** for multi-step writes: `create_transaction`,
  `confirm_transaction`, `record_settlement`, `grant_card_access`. Each one checks
  permissions, validates that splits sum to the total, writes, and logs to the audit table, all in one transaction.
- **PostgREST + RLS** for ordinary reads/lists (no custom REST layer needed).
- **Edge Functions** only for side effects: emails, OCR, statement parsing, webhooks.
- **pg_cron** for scheduled jobs (due-date reminders, invite expiry).

This replaces most of the REST endpoint list in the blueprint.

### A7. Schema details to fix
- Name the profile table **`profiles`**, not `users`. `auth.users` already exists,
  and two "users" tables cause confusion in Supabase.
- `card_access` with both `group_id` and `user_id` is ambiguous. Define it as:
  `user_id IS NULL` = every member of the group, otherwise one specific member.
  Add a partial unique index for each case.
- Store a **hash** of the invite token, not the raw token. Also add `invited_by` and `role`.
- Add `version int` (optimistic locking) to `transactions`. This covers the
  "two friends edit the same transaction" test case.
- Add `idempotency_key` to `transactions` so a double-tap on Submit doesn't
  create two rows.
- Use `transaction_date DATE` (the date on the card statement) separate from
  `created_at`. Add `statement_cycle` (derived from `billing_day`).
- Add `notifications.type` + `payload jsonb` instead of only free-text title/message.
- Write audit logs with **triggers**, not application code, so no write path is missed.
- RLS: use `SECURITY DEFINER` helper functions such as `is_group_member(gid)` and
  `can_use_card(card_id, gid)`. Policies on `group_members` that query
  `group_members` directly cause infinite recursion.
- Don't let a member leave a group while their balance is non-zero. Set
  `status = 'left'` and never delete the membership row.

---

## B. Features to add

Each addition is tagged **MVP** (cheap and high value, worth building now) or
**V2** (build later).

### Credit-card-specific (these make CardMates more than a Splitwise clone)
1. **Billing-cycle view (MVP).** Group charges by statement cycle using
   `billing_day`/`due_day`. For each friend, show *"You owe Heet ₹5,000 for the
   Nov cycle, due before 5 Dec"*. The card's due date becomes the friend's
   deadline, which is the main thing a card owner needs.
2. **Per-friend spending limit on a card (MVP).** `card_access.monthly_limit`.
   Friends' spending raises the owner's credit utilisation (and affects their
   CIBIL score), so owners will want a cap. Warn or block when a friend exceeds it.
3. **Available-limit and utilisation meter (MVP).** Credit limit minus
   unsettled charges this cycle; alert at 30% / 70% utilisation.
4. **Overdue dues (MVP).** A friend's share that is unpaid after the card due
   date is marked *overdue*. Later (V2), allow passing on a share of late fees or interest.
5. **EMI conversions (V2, but design for it now).** Purchases converted to EMI
   (including "no-cost EMI") are very common in India. An EMI plan has tenure,
   interest, processing fee and GST, and creates one charge per month. Reserve
   `kind = 'emi_installment'` and an `emi_plans` table now.
6. **Fees & charges (V2).** Forex markup, fuel surcharge, late fee, annual fee,
   GST on fees. These are recorded as `kind = 'fee'`, assigned to someone or
   split.
7. **Reward/cashback sharing (V2).** An optional group setting that passes
   cashback earned on a friend's spend back to that friend.
8. **Statement reconciliation (MVP-lite → V2).** In MVP, let the owner tick a
   cycle as "matches my statement" by hand. In V2, add CSV/PDF statement upload
   with automatic matching.

### Collaboration
9. **UPI "Pay now" deep link (MVP).** Store `upi_id` on the profile and build
   `upi://pay?pa=<id>&pn=<name>&am=<amt>&tn=CardMates`. No payment gateway is
   needed, and it covers most real settlements in India.
10. **WhatsApp share of dues (MVP).** A `wa.me` link with a prefilled summary
    (*"Amit, you owe ₹5,000 on my HDFC card, due 5 Dec"*). A reminder tool
    friends already use.
11. **Comments thread on a transaction (MVP).** Disputes need a place for
    discussion. Use a `transaction_comments` table, with Realtime for live updates.
12. **Guest / placeholder members (MVP).** Allow adding "Karan" to splits before
    he signs up. When he joins through his invite, he takes over the placeholder.
    Without this, onboarding stalls because nobody can be split with until they register.
13. **Recurring transactions (V2).** Shared Netflix, Spotify, gym, rent on a
    card. A `recurring_rules` table plus pg_cron creates the charges automatically.
14. **Group activity feed (MVP).** Generated from `audit_logs`. "Amit added
    ₹5,000 Amazon on Heet's HDFC."
15. **Debt simplification (V2).** Minimise the number of payments using the pairwise ledger from A1.
16. **Multi-currency trips (V2).** `original_amount`, `original_currency`,
    `fx_rate` on the transaction; balances stay in the group currency.

### Platform
17. **PWA (MVP).** Make the responsive web app installable on phones, and add web push for "confirm this charge".
18. **Export (V2).** CSV/PDF monthly report per group or per card.
19. **Privacy & compliance.** Under India's **DPDP Act 2023**: account deletion
    and data export, a consent notice, and a minimal-data policy. Keep the
    "last 4 digits only" rule, and add a CHECK constraint `last_four ~ '^[0-9]{4}$'`
    so a full card number can never be stored.
20. **Optional MFA** (Supabase Auth supports TOTP) for card owners.

---

## C. Schema delta (summary)

| Table | Change |
|---|---|
| `users` → `profiles` | + `upi_id`, `phone` |
| `group_members` | + `status ('active','left','placeholder')`, `display_name` for guests, nullable `user_id` for placeholders |
| `card_access` | + `monthly_limit`, NULL `user_id` = whole group, partial unique indexes |
| `transactions` | + `kind`, `parent_transaction_id`, `funded_by`, `split_method`, `version`, `idempotency_key`, `transaction_date DATE`, `statement_cycle`, nullable `card_id` |
| `transaction_splits` | + `share_value`; split participant references `group_members.id` (so placeholders work) |
| `settlements` | + `confirmed_by`, `confirmed_at`, optional `card_id` |
| `invitations` | `token_hash`, + `invited_by`, `role` |
| `notifications` | + `type`, `payload jsonb` |
| **new** `transaction_comments` | dispute and discussion thread |
| **new** `card_cycles` | per-card statement cycle + `reconciled_at` |
| **new (V2)** `emi_plans`, `recurring_rules` | |
| **views** | `v_pairwise_debts`, `v_member_balances`, `v_cycle_dues` |

---

## D. Revised build plan

| Sprint | Work |
|---|---|
| 0 | Supabase dev + prod projects, Supabase CLI migrations, seed data, CI running **pgTAP** tests |
| 1 | Schema + RLS + helper functions + audit triggers. **RLS tests first.** |
| 2 | Auth, profiles, groups, invites, placeholder members |
| 3 | Cards, card access, limits |
| 4 | `create_transaction` RPC, split engine (all 5 methods, rounding), confirm/dispute, comments |
| 5 | Pairwise ledger views, settlements (receiver-confirmed), UPI + WhatsApp links, cycle dues |
| 6 | Dashboard, reports, activity feed, PWA, hardening, deploy (Vercel + Supabase) |

Add these to the blueprint's test list:
- Refund of a shared purchase is split back in the same proportions as the original.
- Settlement is marked paid by the payer but rejected by the receiver, so the balance does not change.
- A placeholder member is claimed by a real user, and the history is preserved.
- A friend exceeds `monthly_limit`, and the charge is blocked or warned about.
- Pairwise netting: Amit owes Heet ₹5,000 and Heet owes Amit ₹1,000, so the net is ₹4,000.
- A user from another group tries to read the card or transactions through the REST API and RLS denies it.
- The same idempotency key is sent twice and only one transaction is created.

---

**Recommended next step:** write the Supabase migration (schema, constraints,
indexes, RLS, helper functions, `create_transaction` RPC, ledger views) with
pgTAP tests, then build the Next.js UI on top of it.
