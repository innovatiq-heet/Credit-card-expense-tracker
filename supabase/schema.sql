-- =====================================================================
--  CardMates (personal) – Supabase database schema
-- ---------------------------------------------------------------------
--  How to install:
--    Supabase Dashboard → SQL Editor → New query → paste this whole
--    file → Run.
--
--  ⚠ Step 0 removes any earlier CardMates tables (and their data) so
--    the file can be run on a project that has the old version.
--
--  How it works:
--    * Only you sign in. Everything you create belongs to you.
--    * A group has people (just names, optional phone for WhatsApp).
--    * Every expense is paid by you – with one of your cards or cash/UPI.
--    * Each expense is split into shares: yours (person_id = NULL) and
--      the people who share it. A person's share = money they owe you.
--    * Payments record money a person gave back to you.
--    * balance = what they owe from their shares − what they paid you.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Remove earlier versions (multi-user v1 and this file on re-run)
-- ---------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop view if exists public.person_balances;
drop table if exists
  public.activity, public.settlements, public.transaction_splits, public.transactions,
  public.card_groups, public.group_members,
  public.payments, public.expense_shares, public.expenses, public.people,
  public.groups, public.cards, public.profiles
  cascade;
drop function if exists
  public.handle_new_user(),
  public.is_group_member(uuid), public.is_group_admin(uuid), public.shares_group_with(uuid),
  public.can_see_card(uuid), public.owns_card(uuid), public._is_active_member(uuid, uuid),
  public._log(uuid, text, text, numeric), public._pair_balances(uuid), public._log_card_share(),
  public.create_group(text), public.join_group(text), public.leave_group(uuid),
  public.regenerate_invite_code(uuid),
  public.save_transaction(uuid, uuid, uuid, uuid, uuid, text, text, text, date, numeric, text, jsonb),
  public.delete_transaction(uuid),
  public.add_settlement(uuid, uuid, uuid, numeric, text, text), public.delete_settlement(uuid),
  public.group_balances(uuid), public.my_balances(),
  public.save_expense(uuid, uuid, uuid, text, text, text, date, numeric, text, jsonb);


-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- Your profile (created automatically when you sign up).
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '' check (char_length(full_name) <= 80),
  email       text,
  upi_id      text check (upi_id is null or upi_id ~ '^[A-Za-z0-9._-]{2,200}@[A-Za-z0-9.-]{2,64}$'),
  created_at  timestamptz not null default now()
);

-- Your credit cards. Never store the full number, CVV, PIN or OTP.
create table public.cards (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  nickname     text not null check (char_length(btrim(nickname)) between 1 and 40),
  bank_name    text not null default '' check (char_length(bank_name) <= 40),
  last_four    text not null check (last_four ~ '^[0-9]{4}$'),
  billing_day  smallint check (billing_day between 1 and 31),  -- statement date
  due_day      smallint check (due_day between 1 and 31),      -- payment due date
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index cards_owner_idx on public.cards (owner_id);

create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  created_at  timestamptz not null default now()
);
create index groups_owner_idx on public.groups (owner_id);

-- People in a group – just names, no account needed.
create table public.people (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  group_id    uuid not null references public.groups (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  phone       text check (phone is null or phone ~ '^[0-9+ ()-]{6,20}$'),
  created_at  timestamptz not null default now()
);
create unique index people_group_name_idx on public.people (group_id, lower(btrim(name)));
create index people_owner_idx on public.people (owner_id);

-- Everything here is paid by you (card_id NULL = cash / UPI).
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  group_id      uuid not null references public.groups (id) on delete cascade,
  card_id       uuid references public.cards (id) on delete set null,
  merchant      text not null check (char_length(btrim(merchant)) between 1 and 80),
  note          text not null default '' check (char_length(note) <= 500),
  category      text not null default 'other' check (char_length(category) between 1 and 30),
  amount        numeric(12, 2) not null check (amount > 0),
  split_method  text not null default 'equal' check (split_method in ('equal', 'exact')),
  txn_date      date not null default current_date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index expenses_group_date_idx on public.expenses (group_id, txn_date desc);
create index expenses_card_idx on public.expenses (card_id);
create index expenses_owner_idx on public.expenses (owner_id);

-- Who shares each expense. person_id NULL = your own share.
create table public.expense_shares (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references public.expenses (id) on delete cascade,
  -- Checked at the end of the transaction, so deleting a whole group works,
  -- while deleting a single person who is in an expense is still refused.
  person_id   uuid references public.people (id) deferrable initially deferred,
  amount      numeric(12, 2) not null check (amount > 0),
  unique nulls not distinct (expense_id, person_id)
);
create index expense_shares_person_idx on public.expense_shares (person_id);

-- Money a person paid back to you.
create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  group_id    uuid not null references public.groups (id) on delete cascade,
  person_id   uuid not null references public.people (id) on delete cascade,
  amount      numeric(12, 2) not null check (amount > 0),
  method      text not null default 'upi' check (method in ('upi', 'cash', 'bank', 'other')),
  note        text not null default '' check (char_length(note) <= 200),
  paid_on     date not null default current_date,
  created_at  timestamptz not null default now()
);
create index payments_group_idx on public.payments (group_id);
create index payments_person_idx on public.payments (person_id);


-- ---------------------------------------------------------------------
-- 2. Create your profile automatically when you sign up
-- ---------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1), ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts that already exist (e.g. created before this file was run).
insert into public.profiles (id, full_name, email)
select u.id,
       coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1), ''),
       u.email
from auth.users u
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 3. Row Level Security – you only ever see your own rows
-- ---------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.cards          enable row level security;
alter table public.groups         enable row level security;
alter table public.people         enable row level security;
alter table public.expenses       enable row level security;
alter table public.expense_shares enable row level security;
alter table public.payments       enable row level security;

create policy "profiles: own" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "cards: own" on public.cards
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "groups: own" on public.groups
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "people: own" on public.people
  for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid())
  );

-- Expenses are written only through save_expense() (keeps shares = total);
-- you can read and delete your own.
create policy "expenses: read own" on public.expenses
  for select to authenticated using (owner_id = auth.uid());
create policy "expenses: delete own" on public.expenses
  for delete to authenticated using (owner_id = auth.uid());

create policy "expense_shares: read own" on public.expense_shares
  for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and e.owner_id = auth.uid()));

create policy "payments: own" on public.payments
  for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.people p
      where p.id = person_id and p.group_id = payments.group_id and p.owner_id = auth.uid()
    )
  );


-- ---------------------------------------------------------------------
-- 4. Balances: how much each person still owes you
-- ---------------------------------------------------------------------
-- security_invoker = true → the view obeys the RLS rules above.
create view public.person_balances with (security_invoker = true) as
select
  p.id        as person_id,
  p.group_id,
  p.name,
  p.phone,
  coalesce(o.owed, 0)                         as owed,
  coalesce(pd.paid, 0)                        as paid,
  coalesce(o.owed, 0) - coalesce(pd.paid, 0)  as balance   -- > 0: they owe you
from public.people p
left join (
  select s.person_id, sum(s.amount) as owed
  from public.expense_shares s
  where s.person_id is not null
  group by s.person_id
) o on o.person_id = p.id
left join (
  select person_id, sum(amount) as paid
  from public.payments
  group by person_id
) pd on pd.person_id = p.id;


-- ---------------------------------------------------------------------
-- 5. Add or edit an expense together with its shares (one transaction)
--    p_shares: [{"person_id": null, "amount": 500}, {"person_id": "<uuid>", "amount": 500}]
--    person_id null = your share. Shares must add up exactly to p_amount.
-- ---------------------------------------------------------------------
create function public.save_expense(
  p_id            uuid,
  p_group         uuid,
  p_card          uuid,
  p_merchant      text,
  p_note          text,
  p_category      text,
  p_txn_date      date,
  p_amount        numeric,
  p_split_method  text,
  p_shares        jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_old       expenses;
  v_count     int;
  v_distinct  int;
  v_sum       numeric;
  v_bad       boolean;
  v_id        uuid;
begin
  if v_uid is null then raise exception 'Please sign in first'; end if;
  if not exists (select 1 from groups where id = p_group and owner_id = v_uid) then
    raise exception 'Group not found';
  end if;

  if p_id is not null then
    select * into v_old from expenses where id = p_id and owner_id = v_uid for update;
    if not found or v_old.group_id <> p_group then raise exception 'Expense not found'; end if;
  end if;

  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount > 10000000 then
    raise exception 'Enter a valid amount (up to 2 decimals)';
  end if;
  if p_merchant is null or char_length(btrim(p_merchant)) = 0 then
    raise exception 'Description is required';
  end if;
  if p_split_method not in ('equal', 'exact') then raise exception 'Invalid split method'; end if;

  if p_card is not null then
    if not exists (select 1 from cards where id = p_card and owner_id = v_uid) then
      raise exception 'Card not found';
    end if;
    if p_card is distinct from v_old.card_id
       and not exists (select 1 from cards where id = p_card and is_active) then
      raise exception 'This card is inactive';
    end if;
  end if;

  if p_shares is null or jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'Choose who shares this expense';
  end if;

  select count(*),
         count(distinct coalesce(x.person_id, '00000000-0000-0000-0000-000000000000'::uuid)),
         coalesce(sum(x.amount), 0),
         bool_or(x.amount is null or x.amount <= 0 or x.amount <> round(x.amount, 2))
    into v_count, v_distinct, v_sum, v_bad
  from jsonb_to_recordset(p_shares) as x(person_id uuid, amount numeric);

  if v_bad then raise exception 'Every share must be a positive amount (up to 2 decimals)'; end if;
  if v_count <> v_distinct then raise exception 'A person appears twice in the split'; end if;
  if v_sum <> p_amount then
    raise exception 'Shares add up to % but the expense is %', v_sum, p_amount;
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_shares) as x(person_id uuid, amount numeric)
    where x.person_id is not null
      and not exists (select 1 from people p where p.id = x.person_id and p.group_id = p_group and p.owner_id = v_uid)
  ) then
    raise exception 'Everyone in the split must be a person in this group';
  end if;

  if p_id is null then
    insert into expenses (owner_id, group_id, card_id, merchant, note, category, amount, split_method, txn_date)
    values (v_uid, p_group, p_card, btrim(p_merchant), coalesce(btrim(p_note), ''),
            coalesce(nullif(btrim(p_category), ''), 'other'), p_amount, p_split_method,
            coalesce(p_txn_date, current_date))
    returning id into v_id;
  else
    update expenses
    set card_id = p_card, merchant = btrim(p_merchant), note = coalesce(btrim(p_note), ''),
        category = coalesce(nullif(btrim(p_category), ''), 'other'),
        amount = p_amount, split_method = p_split_method,
        txn_date = coalesce(p_txn_date, v_old.txn_date), updated_at = now()
    where id = p_id;
    delete from expense_shares where expense_id = p_id;
    v_id := p_id;
  end if;

  insert into expense_shares (expense_id, person_id, amount)
  select v_id, x.person_id, x.amount
  from jsonb_to_recordset(p_shares) as x(person_id uuid, amount numeric);

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. Privileges (Supabase grants everything by default – tighten it)
-- ---------------------------------------------------------------------
revoke all on public.profiles, public.cards, public.groups, public.people, public.expenses,
              public.expense_shares, public.payments, public.person_balances
  from anon, authenticated;

grant select on public.profiles, public.cards, public.groups, public.people, public.expenses,
                public.expense_shares, public.payments, public.person_balances
  to authenticated;

grant update (full_name, upi_id) on public.profiles to authenticated;
grant insert (nickname, bank_name, last_four, billing_day, due_day),
      update (nickname, bank_name, last_four, billing_day, due_day, is_active),
      delete on public.cards to authenticated;
grant insert (name), update (name), delete on public.groups to authenticated;
grant insert (group_id, name, phone), update (name, phone), delete on public.people to authenticated;
grant delete on public.expenses to authenticated;
grant insert (group_id, person_id, amount, method, note, paid_on), delete on public.payments to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.save_expense(uuid, uuid, uuid, text, text, text, date, numeric, text, jsonb)
  from public, anon;
grant execute on function public.save_expense(uuid, uuid, uuid, text, text, text, date, numeric, text, jsonb)
  to authenticated;
