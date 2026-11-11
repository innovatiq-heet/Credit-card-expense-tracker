-- CardMates (personal) database tests. Run with:  npm run test:db
-- Every check raises an error (and stops the script) if it fails.
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;
\o /dev/null

-- ---------------------------------------------------------------- helpers
create schema test;
grant usage on schema test to authenticated, anon;

create function test.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;

create function test.eq(p_actual anyelement, p_expected anyelement, p_msg text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAILED: % (expected %, got %)', p_msg, p_expected, p_actual;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

create function test.throws(p_sql text, p_pattern text, p_msg text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike p_pattern then
      raise notice 'ok - %', p_msg;
      return;
    end if;
    raise exception 'FAILED: % (wrong error: %)', p_msg, sqlerrm;
  end;
  raise exception 'FAILED: % (expected an error, none raised)', p_msg;
end $$;

create function test.bal(p_person uuid) returns numeric language sql as $$
  select balance from public.person_balances where person_id = p_person;
$$;

-- shares json: test.shares('me', 500, '<uuid>', 500, ...)  ('me' = your own share)
create function test.shares(variadic p text[]) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', case when p[i] = 'me' then null else p[i]::uuid end,
           'amount', p[i + 1]::numeric)), '[]'::jsonb)
  from generate_series(1, array_length(p, 1), 2) as i;
$$;

grant execute on all functions in schema test to authenticated, anon;

\set heet  '11111111-1111-1111-1111-111111111111'
\set other '99999999-9999-9999-9999-999999999999'

-- ---------------------------------------------------------------- sign-up
insert into auth.users (id, email, raw_user_meta_data) values
  (:'heet',  'heet@example.com',  '{"full_name":"Heet"}'),
  (:'other', 'other@example.com', '{}');
select test.eq((select full_name from profiles where id = :'heet'), 'Heet', 'profile created on sign-up');
select test.eq((select full_name from profiles where id = :'other'), 'other', 'name falls back to email prefix');

set role authenticated;
select test.login(:'heet');

-- ---------------------------------------------------------------- setup
insert into cards (nickname, bank_name, last_four, billing_day, due_day)
  values ('HDFC Millennia', 'HDFC Bank', '1234', 15, 5) returning id as hdfc \gset
select test.eq((select owner_id from cards where id = :'hdfc'), :'heet'::uuid, 'card belongs to me automatically');
select test.throws($$ insert into cards (nickname, last_four) values ('Full', '4111111111111111') $$,
  '%check constraint%', 'full card number can never be stored');

insert into groups (name) values ('Goa Trip') returning id as g \gset
insert into groups (name) values ('Office') returning id as g2 \gset
insert into people (group_id, name, phone) values (:'g', 'Amit', '9876543210') returning id as amit \gset
insert into people (group_id, name) values (:'g', 'Rahul') returning id as rahul \gset
insert into people (group_id, name) values (:'g', 'Karan') returning id as karan \gset
insert into people (group_id, name) values (:'g2', 'Priya') returning id as priya \gset
select test.throws(format($$ insert into people (group_id, name) values (%L, ' amit ') $$, :'g'),
  '%duplicate key%', 'same name twice in a group is rejected');
select test.throws(format($$ insert into people (group_id, name, phone) values (%L, 'Bad', 'call me') $$, :'g'),
  '%check constraint%', 'invalid phone rejected');

-- ---------------------------------------------------------------- expenses
-- ₹5,000 Amazon on my card, all for Amit
select save_expense(null, :'g', :'hdfc', 'Amazon', '', 'shopping', '2026-11-02', 5000, 'equal',
  test.shares(:'amit', '5000')) as e_amazon \gset
select test.eq(test.bal(:'amit'), 5000.00, 'Amit owes me 5,000');

-- ₹6,000 hotel split me/Amit/Rahul
select save_expense(null, :'g', :'hdfc', 'Hotel', '', 'travel', '2026-11-05', 6000, 'equal',
  test.shares('me', '2000', :'amit', '2000', :'rahul', '2000')) as e_hotel \gset
select test.eq(test.bal(:'amit'), 7000.00, 'Amit now owes 7,000');
select test.eq(test.bal(:'rahul'), 2000.00, 'Rahul owes 2,000');

-- ₹100 split three ways, cash
select save_expense(null, :'g', null, 'Chai', '', 'food', '2026-11-05', 100, 'equal',
  test.shares('me', '33.34', :'rahul', '33.33', :'karan', '33.33')) as e_chai \gset
select test.eq((select sum(amount) from expense_shares where expense_id = :'e_chai'), 100.00, '₹100 / 3 adds up exactly');
select test.eq(test.bal(:'karan'), 33.33, 'Karan owes 33.33');
select test.eq((select card_id from expenses where id = :'e_chai'), null::uuid, 'cash expense has no card');

-- my own expense: nobody owes anything
select save_expense(null, :'g', :'hdfc', 'Shoes', '', 'shopping', '2026-11-06', 2500, 'equal', test.shares('me', '2500'));
select test.eq(test.bal(:'amit'), 7000.00, 'my own expense changes nobody''s balance');

-- ---------------------------------------------------------------- validation
select test.throws(format($$ select save_expense(null, %L, null, 'X', '', 'other', null, 100, 'exact', test.shares('me', '60', %L, '30')) $$, :'g', :'amit'),
  '%add up to%', 'shares must add up to the amount');
select test.throws(format($$ select save_expense(null, %L, null, 'X', '', 'other', null, 100, 'exact', test.shares('me', '50', 'me', '50')) $$, :'g'),
  '%appears twice%', 'me twice rejected');
select test.throws(format($$ select save_expense(null, %L, null, 'X', '', 'other', null, 100, 'exact', test.shares(%L, '50', %L, '50')) $$, :'g', :'amit', :'amit'),
  '%appears twice%', 'same person twice rejected');
select test.throws(format($$ select save_expense(null, %L, null, 'X', '', 'other', null, 100, 'exact', test.shares(%L, '100')) $$, :'g', :'priya'),
  '%person in this group%', 'person from another group rejected');
select test.throws(format($$ select save_expense(null, %L, null, 'X', '', 'other', null, 10.005, 'exact', test.shares('me', '10.005')) $$, :'g'),
  '%valid amount%', 'more than 2 decimals rejected');
select test.throws(format($$ select save_expense(null, %L, null, 'X', '', 'other', null, 100, 'exact', '[]'::jsonb) $$, :'g'),
  '%who shares%', 'empty split rejected');
select test.throws(format($$ select save_expense(null, %L, null, '  ', '', 'other', null, 100, 'exact', test.shares('me', '100')) $$, :'g'),
  '%Description%', 'description required');

-- ---------------------------------------------------------------- edit & delete
select save_expense(:'e_amazon', :'g', :'hdfc', 'Amazon', 'corrected', 'shopping', '2026-11-02', 4000, 'equal', test.shares(:'amit', '4000'));
select test.eq(test.bal(:'amit'), 6000.00, 'editing the amount updates the balance');
select test.eq((select count(*) from expense_shares where expense_id = :'e_amazon'), 1::bigint, 'old shares replaced on edit');
select test.throws(format($$ select save_expense(%L, %L, null, 'X', '', 'other', null, 1, 'exact', test.shares('me', '1')) $$, :'e_amazon', :'g2'),
  '%Expense not found%', 'cannot move an expense to another group');

delete from expenses where id = :'e_amazon';
select test.eq(test.bal(:'amit'), 2000.00, 'deleted expense no longer counts');

-- ---------------------------------------------------------------- payments
insert into payments (group_id, person_id, amount, method, note) values (:'g', :'amit', 500, 'upi', 'part') returning id as p1 \gset
select test.eq(test.bal(:'amit'), 1500.00, 'part payment reduces what Amit owes');
select test.throws(format($$ insert into payments (group_id, person_id, amount) values (%L, %L, 10) $$, :'g2', :'amit'),
  '%row-level security%', 'payment must use the person''s own group');
delete from payments where id = :'p1';
select test.eq(test.bal(:'amit'), 2000.00, 'undoing a payment restores the balance');
insert into payments (group_id, person_id, amount) values (:'g', :'amit', 2000);
select test.eq(test.bal(:'amit'), 0::numeric, 'full payment settles Amit');

-- ---------------------------------------------------------------- people
-- (the check is deferred to commit; in the app each request is its own transaction)
select test.throws(format($$ delete from people where id = %L; set constraints all immediate $$, :'rahul'),
  '%foreign key%', 'cannot delete a person who is in an expense');
insert into people (group_id, name) values (:'g', 'Temp') returning id as temp \gset
delete from people where id = :'temp';
select test.eq((select count(*) from people where id = :'temp'), 0::bigint, 'person with no expenses can be removed');
update people set name = 'Rahul S' where id = :'rahul';
select test.eq((select name from person_balances where person_id = :'rahul'), 'Rahul S', 'rename a person');

-- ---------------------------------------------------------------- privacy: another account
select test.login(:'other');
select test.eq((select count(*) from groups), 0::bigint, 'other account sees none of my groups');
select test.eq((select count(*) from people), 0::bigint, '... none of my people');
select test.eq((select count(*) from expenses), 0::bigint, '... none of my expenses');
select test.eq((select count(*) from expense_shares), 0::bigint, '... none of my shares');
select test.eq((select count(*) from person_balances), 0::bigint, '... none of my balances');
select test.eq((select count(*) from cards), 0::bigint, '... none of my cards');
select test.eq((select count(*) from profiles), 1::bigint, '... only its own profile');
select test.throws(format($$ select save_expense(null, %L, null, 'X', '', 'other', null, 10, 'exact', test.shares('me', '10')) $$, :'g'),
  '%Group not found%', 'other account cannot add expenses to my group');
select test.throws(format($$ insert into people (group_id, name) values (%L, 'Spy') $$, :'g'),
  '%row-level security%', 'other account cannot add people to my group');
select test.throws(format($$ insert into payments (group_id, person_id, amount) values (%L, %L, 1) $$, :'g', :'rahul'),
  '%row-level security%', 'other account cannot record payments in my group');
insert into groups (name) values ('Mine') returning id as og \gset
select test.throws(format($$ select save_expense(null, %L, %L, 'X', '', 'other', null, 10, 'exact', test.shares('me', '10')) $$, :'og', :'hdfc'),
  '%Card not found%', 'other account cannot charge my card');
select test.throws(format($$ select save_expense(null, %L, null, 'X', '', 'other', null, 10, 'exact', test.shares(%L, '10')) $$, :'og', :'rahul'),
  '%person in this group%', 'other account cannot put my people in its expenses');
delete from groups where id = :'g';  -- silently affects 0 rows
select test.login(:'heet');
select test.eq((select count(*) from groups where id = :'g'), 1::bigint, 'other account cannot delete my group');

-- ---------------------------------------------------------------- direct writes are limited
select test.throws(format($$ insert into expenses (group_id, merchant, amount) values (%L, 'hack', 1) $$, :'g'),
  '%permission denied%', 'no direct insert into expenses (must use save_expense)');
select test.throws(format($$ update expense_shares set amount = 1 where expense_id = %L $$, :'e_hotel'),
  '%permission denied%', 'no direct edit of shares');
select test.throws($$ update profiles set email = 'x@y.z' $$, '%permission denied%', 'email cannot be changed from the app');
select test.throws(format($$ insert into groups (owner_id, name) values (%L, 'x') $$, :'other'),
  '%permission denied%', 'cannot create a group for someone else');

-- ---------------------------------------------------------------- deleting a group removes everything in it
delete from groups where id = :'g';
select test.eq((select count(*) from expenses where group_id = :'g'), 0::bigint, 'group delete removes its expenses');
select test.eq((select count(*) from people where group_id = :'g'), 0::bigint, '... its people');
select test.eq((select count(*) from payments where group_id = :'g'), 0::bigint, '... and its payments');
select test.eq((select count(*) from cards where id = :'hdfc'), 1::bigint, 'cards are kept');

-- ---------------------------------------------------------------- anonymous visitors
reset role;
set role anon;
select test.throws($$ select * from groups $$, '%permission denied%', 'anon cannot read anything');
select test.throws($$ select save_expense(null, null, null, 'x', '', 'other', null, 1, 'exact', '[]'::jsonb) $$,
  '%permission denied%', 'anon cannot call save_expense');
reset role;

\echo 'All CardMates database tests passed.'
