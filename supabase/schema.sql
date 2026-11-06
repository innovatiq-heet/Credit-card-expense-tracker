-- =====================================================================
--  CardMates – Supabase database schema
-- ---------------------------------------------------------------------
--  How to install:
--    Supabase Dashboard → SQL Editor → New query → paste this whole
--    file → Run.  Run it once on a fresh project.
--
--  Money model (keep this in mind when reading the code):
--    * Every transaction has `paid_by` = the person whose money was used.
--        - card transaction  → paid_by = the card owner
--        - cash / UPI        → paid_by = whoever paid
--    * `transaction_splits` = who is responsible for how much.
--    * Each split creates a debt:  split.user  →  owes  →  paid_by
--      (a person never owes themselves).
--    * A settlement "A paid B ₹X" reduces A's debt to B by ₹X.
--    * Balances are kept pair-by-pair inside each group, so the app can
--      always say exactly who pays whom.
--
--  Security model:
--    * Row Level Security is ON for every table.
--    * Reads go through RLS policies (you only see groups you are in).
--    * All money writes (transactions, splits, settlements) go through
--      SECURITY DEFINER functions below that check permissions and keep
--      totals consistent inside a single database transaction.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- App profile for each Supabase Auth user (created automatically on sign-up).
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '' check (char_length(full_name) <= 80),
  email       text,
  upi_id      text check (upi_id is null or upi_id ~ '^[A-Za-z0-9._-]{2,200}@[A-Za-z0-9.-]{2,64}$'),
  created_at  timestamptz not null default now()
);

create table public.groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  invite_code  text not null unique
               default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now()
);

create table public.group_members (
  group_id   uuid not null references public.groups (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'member' check (role in ('admin', 'member')),
  is_active  boolean not null default true,     -- false = left the group (history is kept)
  joined_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

-- A card belongs to ONE person. Never store the full number, CVV, PIN or OTP.
create table public.cards (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  nickname     text not null check (char_length(btrim(nickname)) between 1 and 40),
  bank_name    text not null default '' check (char_length(bank_name) <= 40),
  last_four    text not null check (last_four ~ '^[0-9]{4}$'),
  billing_day  smallint check (billing_day between 1 and 31),  -- statement date
  due_day      smallint check (due_day between 1 and 31),      -- payment due date
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index cards_owner_idx on public.cards (owner_id);

-- Which groups a card is shared with. Every member of a shared group can
-- record charges on that card. Only the card owner can share / unshare.
create table public.card_groups (
  card_id     uuid not null references public.cards (id) on delete cascade,
  group_id    uuid not null references public.groups (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (card_id, group_id)
);
create index card_groups_group_idx on public.card_groups (group_id);

create table public.transactions (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id),
  card_id       uuid references public.cards (id),           -- null = cash / UPI
  paid_by       uuid not null references public.profiles (id),  -- whose money was used
  purchased_by  uuid references public.profiles (id),        -- who made the purchase (null = unknown)
  created_by    uuid not null references public.profiles (id),
  merchant      text not null check (char_length(btrim(merchant)) between 1 and 80),
  note          text not null default '' check (char_length(note) <= 500),
  category      text not null default 'other' check (char_length(category) between 1 and 30),
  amount        numeric(12, 2) not null check (amount > 0),
  split_method  text not null default 'equal' check (split_method in ('equal', 'exact')),
  txn_date      date not null default current_date,
  is_deleted    boolean not null default false,   -- soft delete, money records are never erased
  deleted_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index transactions_group_date_idx on public.transactions (group_id, txn_date desc);
create index transactions_card_idx on public.transactions (card_id);

create table public.transaction_splits (
  transaction_id  uuid not null references public.transactions (id) on delete cascade,
  user_id         uuid not null references public.profiles (id),
  amount          numeric(12, 2) not null check (amount > 0),
  primary key (transaction_id, user_id)
);
create index transaction_splits_user_idx on public.transaction_splits (user_id);

create table public.settlements (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id),
  from_user   uuid not null references public.profiles (id),  -- who paid
  to_user     uuid not null references public.profiles (id),  -- who received
  amount      numeric(12, 2) not null check (amount > 0),
  method      text not null default 'upi' check (method in ('upi', 'cash', 'bank', 'other')),
  note        text not null default '' check (char_length(note) <= 200),
  created_by  uuid not null references public.profiles (id),
  is_deleted  boolean not null default false,
  deleted_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  check (from_user <> to_user)
);
create index settlements_group_idx on public.settlements (group_id);

-- Simple activity feed / audit trail ("Amit added Amazon ₹5,000").
create table public.activity (
  id          bigint generated always as identity primary key,
  group_id    uuid not null references public.groups (id) on delete cascade,
  actor_id    uuid references public.profiles (id),
  action      text not null,
  label       text not null default '',
  amount      numeric(12, 2),
  created_at  timestamptz not null default now()
);
create index activity_group_idx on public.activity (group_id, created_at desc);


-- ---------------------------------------------------------------------
-- 2. Create a profile automatically when someone signs up
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

-- Users who signed up before this script was run.
insert into public.profiles (id, full_name, email)
select u.id,
       coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1), ''),
       u.email
from auth.users u
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 3. Helper functions used by RLS policies
--    (SECURITY DEFINER so policies don't recurse into group_members' own RLS)
-- ---------------------------------------------------------------------
create function public.is_group_member(p_group uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group and user_id = auth.uid() and is_active
  );
$$;

create function public.is_group_admin(p_group uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group and user_id = auth.uid() and is_active and role = 'admin'
  );
$$;

-- Can the current user see this person's profile? (they share a group)
create function public.shares_group_with(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from group_members me
    join group_members them on them.group_id = me.group_id
    where me.user_id = auth.uid() and me.is_active and them.user_id = p_user
  );
$$;

-- Can the current user see this card? (shared with, or used in, one of my groups)
create function public.can_see_card(p_card uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from card_groups cg
    join group_members gm on gm.group_id = cg.group_id
    where cg.card_id = p_card and gm.user_id = auth.uid() and gm.is_active
  ) or exists (
    select 1 from transactions t
    join group_members gm on gm.group_id = t.group_id
    where t.card_id = p_card and gm.user_id = auth.uid() and gm.is_active
  );
$$;

create function public.owns_card(p_card uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from cards where id = p_card and owner_id = auth.uid());
$$;

-- Internal: is a given user an active member of a group?
create function public._is_active_member(p_group uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group and user_id = p_user and is_active
  );
$$;


-- ---------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.groups             enable row level security;
alter table public.group_members      enable row level security;
alter table public.cards              enable row level security;
alter table public.card_groups        enable row level security;
alter table public.transactions       enable row level security;
alter table public.transaction_splits enable row level security;
alter table public.settlements        enable row level security;
alter table public.activity           enable row level security;

-- profiles
create policy "profiles: read self and group mates" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));
create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- groups (created / joined through functions below)
create policy "groups: members read" on public.groups
  for select to authenticated
  using (public.is_group_member(id));
create policy "groups: admins rename" on public.groups
  for update to authenticated
  using (public.is_group_admin(id)) with check (public.is_group_admin(id));

-- group_members (changed only through functions below)
create policy "group_members: members read" on public.group_members
  for select to authenticated
  using (public.is_group_member(group_id));

-- cards
create policy "cards: owner and group mates read" on public.cards
  for select to authenticated
  using (owner_id = auth.uid() or public.can_see_card(id));
create policy "cards: owner adds" on public.cards
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy "cards: owner edits" on public.cards
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- card_groups
create policy "card_groups: read" on public.card_groups
  for select to authenticated
  using (public.is_group_member(group_id) or public.owns_card(card_id));
create policy "card_groups: owner shares into own groups" on public.card_groups
  for insert to authenticated
  with check (public.owns_card(card_id) and public.is_group_member(group_id));
create policy "card_groups: owner unshares" on public.card_groups
  for delete to authenticated
  using (public.owns_card(card_id));

-- transactions / splits / settlements / activity: read-only through RLS,
-- every write goes through the functions in section 6.
create policy "transactions: members read" on public.transactions
  for select to authenticated
  using (public.is_group_member(group_id));
create policy "transaction_splits: members read" on public.transaction_splits
  for select to authenticated
  using (exists (
    select 1 from public.transactions t
    where t.id = transaction_id and public.is_group_member(t.group_id)
  ));
create policy "settlements: members read" on public.settlements
  for select to authenticated
  using (public.is_group_member(group_id));
create policy "activity: members read" on public.activity
  for select to authenticated
  using (public.is_group_member(group_id));


-- ---------------------------------------------------------------------
-- 5. Table privileges (Supabase grants everything by default – tighten it)
-- ---------------------------------------------------------------------
revoke all on public.profiles, public.groups, public.group_members, public.cards,
              public.card_groups, public.transactions, public.transaction_splits,
              public.settlements, public.activity
  from anon, authenticated;

grant select on public.profiles, public.groups, public.group_members, public.cards,
                public.card_groups, public.transactions, public.transaction_splits,
                public.settlements, public.activity
  to authenticated;

grant update (full_name, upi_id) on public.profiles to authenticated;
grant update (name) on public.groups to authenticated;
grant insert (owner_id, nickname, bank_name, last_four, billing_day, due_day) on public.cards to authenticated;
grant update (nickname, bank_name, last_four, billing_day, due_day, is_active) on public.cards to authenticated;
grant insert (card_id, group_id), delete on public.card_groups to authenticated;


-- ---------------------------------------------------------------------
-- 6. Business functions (called from the app with supabase.rpc(...))
-- ---------------------------------------------------------------------

-- Internal: log an activity row.
create function public._log(p_group uuid, p_action text, p_label text, p_amount numeric default null)
returns void
language sql security definer set search_path = public
as $$
  insert into activity (group_id, actor_id, action, label, amount)
  values (p_group, auth.uid(), p_action, coalesce(p_label, ''), p_amount);
$$;

-- Internal: net pairwise balances of one group.
-- Returns one row per pair that is not settled: from_user owes to_user `amount`.
create function public._pair_balances(p_group uuid)
returns table (from_user uuid, to_user uuid, amount numeric)
language sql stable security definer set search_path = public
as $$
  with debts as (
    -- each split: split user owes the person whose money was used
    select s.user_id as debtor, t.paid_by as creditor, s.amount
    from transactions t
    join transaction_splits s on s.transaction_id = t.id
    where t.group_id = p_group and not t.is_deleted and s.user_id <> t.paid_by
    union all
    -- a payment from A to B works like B now owing A
    select st.to_user, st.from_user, st.amount
    from settlements st
    where st.group_id = p_group and not st.is_deleted
  ),
  pairs as (
    select least(debtor, creditor) as a,
           greatest(debtor, creditor) as b,
           sum(case when debtor < creditor then amount else -amount end) as net
    from debts
    group by 1, 2
  )
  select case when net > 0 then a else b end,
         case when net > 0 then b else a end,
         abs(net)
  from pairs
  where net <> 0;
$$;

-- Create a group; the creator becomes its admin.
create function public.create_group(p_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Please sign in first'; end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Group name is required';
  end if;

  insert into groups (name, created_by) values (btrim(p_name), v_uid) returning id into v_id;
  insert into group_members (group_id, user_id, role) values (v_id, v_uid, 'admin');
  perform _log(v_id, 'group_created', btrim(p_name));
  return v_id;
end;
$$;

-- Join a group with its invite code.
create function public.join_group(p_code text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_group  groups;
  v_member group_members;
begin
  if v_uid is null then raise exception 'Please sign in first'; end if;

  select * into v_group from groups
  where invite_code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  if not found then raise exception 'Invalid invite code'; end if;

  select * into v_member from group_members where group_id = v_group.id and user_id = v_uid;
  if found and v_member.is_active then
    return v_group.id;  -- already a member
  end if;

  insert into group_members (group_id, user_id, role, is_active, joined_at)
  values (v_group.id, v_uid, 'member', true, now())
  on conflict (group_id, user_id) do update set is_active = true, joined_at = now();

  perform _log(v_group.id, 'member_joined', '');
  return v_group.id;
end;
$$;

-- Leave a group. Only allowed when you owe nobody and nobody owes you.
create function public.leave_group(p_group uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then raise exception 'Please sign in first'; end if;
  select role into v_role from group_members
  where group_id = p_group and user_id = v_uid and is_active;
  if not found then raise exception 'You are not a member of this group'; end if;

  if exists (select 1 from _pair_balances(p_group) b where v_uid in (b.from_user, b.to_user)) then
    raise exception 'Settle all your balances in this group before leaving';
  end if;

  -- stop sharing my cards with this group
  delete from card_groups cg using cards c
  where cg.card_id = c.id and c.owner_id = v_uid and cg.group_id = p_group;

  update group_members set is_active = false where group_id = p_group and user_id = v_uid;

  -- keep at least one admin
  if v_role = 'admin' and not exists (
    select 1 from group_members where group_id = p_group and is_active and role = 'admin'
  ) then
    update group_members set role = 'admin'
    where (group_id, user_id) = (
      select group_id, user_id from group_members
      where group_id = p_group and is_active
      order by joined_at limit 1
    );
  end if;

  perform _log(p_group, 'member_left', '');
end;
$$;

-- Admin: create a new invite code (old one stops working).
create function public.regenerate_invite_code(p_group uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
begin
  if not is_group_admin(p_group) then raise exception 'Only a group admin can do this'; end if;
  update groups
  set invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  where id = p_group
  returning invite_code into v_code;
  return v_code;
end;
$$;

-- Add (p_id = null) or edit (p_id = existing id) a transaction with its splits.
-- p_splits: JSON array like [{"user_id": "...", "amount": 1000.00}, ...]
-- The splits must add up exactly to p_amount.
create function public.save_transaction(
  p_id            uuid,
  p_group         uuid,
  p_card          uuid,
  p_paid_by       uuid,
  p_purchased_by  uuid,
  p_merchant      text,
  p_note          text,
  p_category      text,
  p_txn_date      date,
  p_amount        numeric,
  p_split_method  text,
  p_splits        jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_old       transactions;
  v_card      cards;
  v_paid_by   uuid;
  v_count     int;
  v_distinct  int;
  v_sum       numeric;
  v_bad       boolean;
  v_id        uuid;
begin
  if v_uid is null then raise exception 'Please sign in first'; end if;
  if not _is_active_member(p_group, v_uid) then
    raise exception 'You are not a member of this group';
  end if;

  -- editing: only the person who added it, or whose money was used
  if p_id is not null then
    select * into v_old from transactions where id = p_id for update;
    if not found or v_old.group_id <> p_group or v_old.is_deleted then
      raise exception 'Transaction not found';
    end if;
    if v_uid not in (v_old.created_by, v_old.paid_by) then
      raise exception 'Only the person who added this expense or the card owner / payer can edit it';
    end if;
  end if;

  -- amount
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount > 10000000 then
    raise exception 'Enter a valid amount (up to 2 decimals)';
  end if;
  if p_merchant is null or char_length(btrim(p_merchant)) = 0 then
    raise exception 'Description is required';
  end if;
  if p_split_method not in ('equal', 'exact') then
    raise exception 'Invalid split method';
  end if;

  -- whose money was used
  if p_card is not null then
    select * into v_card from cards where id = p_card;
    if not found then raise exception 'Card not found'; end if;
    if p_card is distinct from v_old.card_id then
      if not v_card.is_active then raise exception 'This card is inactive'; end if;
      if not exists (select 1 from card_groups where card_id = p_card and group_id = p_group) then
        raise exception 'This card is not shared with this group';
      end if;
    end if;
    v_paid_by := v_card.owner_id;
  else
    v_paid_by := coalesce(p_paid_by, v_uid);
    if not _is_active_member(p_group, v_paid_by) then
      raise exception 'The payer must be a member of this group';
    end if;
  end if;

  if p_purchased_by is not null and not _is_active_member(p_group, p_purchased_by) then
    raise exception 'The purchaser must be a member of this group';
  end if;

  -- splits
  if p_splits is null or jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
    raise exception 'Choose who shares this expense';
  end if;

  select count(*), count(distinct x.user_id), coalesce(sum(x.amount), 0),
         bool_or(x.user_id is null or x.amount is null or x.amount <= 0 or x.amount <> round(x.amount, 2))
    into v_count, v_distinct, v_sum, v_bad
  from jsonb_to_recordset(p_splits) as x(user_id uuid, amount numeric);

  if v_bad then raise exception 'Every share must be a positive amount (up to 2 decimals)'; end if;
  if v_count <> v_distinct then raise exception 'A person appears twice in the split'; end if;
  if v_sum <> p_amount then
    raise exception 'Shares add up to % but the expense is %', v_sum, p_amount;
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_splits) as x(user_id uuid, amount numeric)
    where not _is_active_member(p_group, x.user_id)
  ) then
    raise exception 'Everyone in the split must be a member of this group';
  end if;

  -- write
  if p_id is null then
    insert into transactions (group_id, card_id, paid_by, purchased_by, created_by, merchant, note,
                              category, amount, split_method, txn_date)
    values (p_group, p_card, v_paid_by, p_purchased_by, v_uid, btrim(p_merchant), coalesce(btrim(p_note), ''),
            coalesce(nullif(btrim(p_category), ''), 'other'), p_amount, p_split_method,
            coalesce(p_txn_date, current_date))
    returning id into v_id;
    perform _log(p_group, 'transaction_added', btrim(p_merchant), p_amount);
  else
    update transactions
    set card_id = p_card, paid_by = v_paid_by, purchased_by = p_purchased_by,
        merchant = btrim(p_merchant), note = coalesce(btrim(p_note), ''),
        category = coalesce(nullif(btrim(p_category), ''), 'other'),
        amount = p_amount, split_method = p_split_method,
        txn_date = coalesce(p_txn_date, v_old.txn_date), updated_at = now()
    where id = p_id;
    delete from transaction_splits where transaction_id = p_id;
    v_id := p_id;
    perform _log(p_group, 'transaction_edited', btrim(p_merchant), p_amount);
  end if;

  insert into transaction_splits (transaction_id, user_id, amount)
  select v_id, x.user_id, x.amount
  from jsonb_to_recordset(p_splits) as x(user_id uuid, amount numeric);

  return v_id;
end;
$$;

-- Delete (soft) a transaction. Allowed for the person who added it or whose money was used.
create function public.delete_transaction(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   transactions;
begin
  if v_uid is null then raise exception 'Please sign in first'; end if;
  select * into v_t from transactions where id = p_id and not is_deleted for update;
  if not found or not _is_active_member(v_t.group_id, v_uid) then
    raise exception 'Transaction not found';
  end if;
  if v_uid not in (v_t.created_by, v_t.paid_by) then
    raise exception 'Only the person who added this expense or the card owner / payer can delete it';
  end if;

  update transactions set is_deleted = true, deleted_by = v_uid, updated_at = now() where id = p_id;
  perform _log(v_t.group_id, 'transaction_deleted', v_t.merchant, v_t.amount);
end;
$$;

-- Record a payment between two members. The caller must be the payer or the receiver.
create function public.add_settlement(
  p_group   uuid,
  p_from    uuid,
  p_to      uuid,
  p_amount  numeric,
  p_method  text,
  p_note    text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Please sign in first'; end if;
  if v_uid not in (p_from, p_to) then
    raise exception 'You can only record payments you made or received';
  end if;
  if p_from = p_to then raise exception 'Payer and receiver must be different'; end if;
  if not _is_active_member(p_group, p_from) or not _is_active_member(p_group, p_to) then
    raise exception 'Both people must be members of this group';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount > 10000000 then
    raise exception 'Enter a valid amount (up to 2 decimals)';
  end if;

  insert into settlements (group_id, from_user, to_user, amount, method, note, created_by)
  values (p_group, p_from, p_to, p_amount,
          case when p_method in ('upi', 'cash', 'bank', 'other') then p_method else 'other' end,
          coalesce(btrim(p_note), ''), v_uid)
  returning id into v_id;

  perform _log(p_group, 'settlement_added',
               (select full_name from profiles where id = p_from) || ' → ' ||
               (select full_name from profiles where id = p_to), p_amount);
  return v_id;
end;
$$;

-- Undo a recorded payment (payer or receiver can do this, e.g. if it was entered by mistake).
create function public.delete_settlement(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_s   settlements;
begin
  if v_uid is null then raise exception 'Please sign in first'; end if;
  select * into v_s from settlements where id = p_id and not is_deleted for update;
  if not found or v_uid not in (v_s.from_user, v_s.to_user) then
    raise exception 'Payment not found';
  end if;
  update settlements set is_deleted = true, deleted_by = v_uid where id = p_id;
  perform _log(v_s.group_id, 'settlement_deleted',
               (select full_name from profiles where id = v_s.from_user) || ' → ' ||
               (select full_name from profiles where id = v_s.to_user), v_s.amount);
end;
$$;

-- Who owes whom in a group (members only).
create function public.group_balances(p_group uuid)
returns table (from_user uuid, to_user uuid, amount numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_group_member(p_group) then raise exception 'You are not a member of this group'; end if;
  return query select * from _pair_balances(p_group);
end;
$$;

-- My balances across all my groups.  amount > 0 → they owe me,  amount < 0 → I owe them.
create function public.my_balances()
returns table (group_id uuid, group_name text, other_user uuid, other_name text,
               other_upi text, amount numeric)
language sql stable security definer set search_path = public
as $$
  select g.id, g.name, p.id, p.full_name, p.upi_id,
         case when b.to_user = auth.uid() then b.amount else -b.amount end
  from group_members gm
  join groups g on g.id = gm.group_id
  cross join lateral _pair_balances(gm.group_id) b
  join profiles p on p.id = case when b.to_user = auth.uid() then b.from_user else b.to_user end
  where gm.user_id = auth.uid() and gm.is_active
    and auth.uid() in (b.from_user, b.to_user);
$$;


-- ---------------------------------------------------------------------
-- 7. Activity log for card sharing
-- ---------------------------------------------------------------------
create function public._log_card_share()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_card cards;
begin
  if tg_op = 'INSERT' then
    select * into v_card from cards where id = new.card_id;
    insert into activity (group_id, actor_id, action, label)
    values (new.group_id, v_card.owner_id, 'card_shared', v_card.nickname || ' ••' || v_card.last_four);
    return new;
  else
    select * into v_card from cards where id = old.card_id;
    if found and exists (select 1 from groups where id = old.group_id) then
      insert into activity (group_id, actor_id, action, label)
      values (old.group_id, v_card.owner_id, 'card_unshared', v_card.nickname || ' ••' || v_card.last_four);
    end if;
    return old;
  end if;
end;
$$;

create trigger card_groups_activity
  after insert or delete on public.card_groups
  for each row execute function public._log_card_share();


-- ---------------------------------------------------------------------
-- 8. Function privileges
--    Supabase lets anon/authenticated call every function by default.
--    Internal helpers are locked down; app functions need a signed-in user.
-- ---------------------------------------------------------------------
revoke execute on function
  public.handle_new_user(),
  public._is_active_member(uuid, uuid),
  public._log(uuid, text, text, numeric),
  public._pair_balances(uuid),
  public._log_card_share()
from public, anon, authenticated;

revoke execute on function
  public.is_group_member(uuid),
  public.is_group_admin(uuid),
  public.shares_group_with(uuid),
  public.can_see_card(uuid),
  public.owns_card(uuid),
  public.create_group(text),
  public.join_group(text),
  public.leave_group(uuid),
  public.regenerate_invite_code(uuid),
  public.save_transaction(uuid, uuid, uuid, uuid, uuid, text, text, text, date, numeric, text, jsonb),
  public.delete_transaction(uuid),
  public.add_settlement(uuid, uuid, uuid, numeric, text, text),
  public.delete_settlement(uuid),
  public.group_balances(uuid),
  public.my_balances()
from public, anon;

grant execute on function
  public.is_group_member(uuid),
  public.is_group_admin(uuid),
  public.shares_group_with(uuid),
  public.can_see_card(uuid),
  public.owns_card(uuid),
  public.create_group(text),
  public.join_group(text),
  public.leave_group(uuid),
  public.regenerate_invite_code(uuid),
  public.save_transaction(uuid, uuid, uuid, uuid, uuid, text, text, text, date, numeric, text, jsonb),
  public.delete_transaction(uuid),
  public.add_settlement(uuid, uuid, uuid, numeric, text, text),
  public.delete_settlement(uuid),
  public.group_balances(uuid),
  public.my_balances()
to authenticated;
