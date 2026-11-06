-- CardMates database tests. Run with:  npm run test:db
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

-- net amount p_from owes p_to in a group (negative if it is the other way round)
create function test.owes(p_group uuid, p_from uuid, p_to uuid) returns numeric
language sql as $$
  select coalesce(
    (select amount from public.group_balances(p_group) where from_user = p_from and to_user = p_to),
    (select -amount from public.group_balances(p_group) where from_user = p_to and to_user = p_from),
    0);
$$;

grant execute on all functions in schema test to authenticated, anon;

\set heet     '11111111-1111-1111-1111-111111111111'
\set rahul    '22222222-2222-2222-2222-222222222222'
\set amit     '33333333-3333-3333-3333-333333333333'
\set karan    '44444444-4444-4444-4444-444444444444'
\set outsider '55555555-5555-5555-5555-555555555555'

-- ---------------------------------------------------------------- sign-up
insert into auth.users (id, email, raw_user_meta_data) values
  (:'heet',     'heet@example.com',  '{"full_name":"Heet"}'),
  (:'rahul',    'rahul@example.com', '{"full_name":"Rahul"}'),
  (:'amit',     'amit@example.com',  '{"full_name":"Amit"}'),
  (:'karan',    'karan@example.com', '{}'),
  (:'outsider', 'out@example.com',   '{"full_name":"Outsider"}');

select test.eq((select count(*) from profiles), 5::bigint, 'profile created for every sign-up');
select test.eq((select full_name from profiles where id = :'karan'), 'karan', 'name falls back to email prefix');

set role authenticated;

-- ---------------------------------------------------------------- groups
select test.login(:'heet');
select create_group('Ahmedabad Friends') as g \gset
select invite_code as code from groups where id = :'g' \gset
select test.eq((select role from group_members where group_id = :'g' and user_id = :'heet'), 'admin', 'creator is admin');

select test.login(:'rahul');  select join_group(:'code');
select test.login(:'amit');   select join_group(lower(:'code'));
select test.login(:'karan');  select join_group(' ' || :'code' || ' ');
select test.eq((select count(*) from group_members where group_id = :'g'), 4::bigint, 'three friends joined with the invite code');
select test.throws($$ select join_group('NOPE1234') $$, '%Invalid invite code%', 'wrong invite code rejected');

select test.login(:'outsider');
select test.eq((select count(*) from groups), 0::bigint, 'outsider cannot see the group');
select test.eq((select count(*) from profiles where id = :'heet'), 0::bigint, 'outsider cannot see group members profiles');
select test.eq((select count(*) from profiles), 1::bigint, 'outsider sees only own profile');
select create_group('Outsider Group') as og \gset

-- ---------------------------------------------------------------- cards
select test.login(:'heet');
insert into cards (owner_id, nickname, bank_name, last_four, billing_day, due_day)
  values (:'heet', 'HDFC Millennia', 'HDFC Bank', '1234', 15, 5) returning id as hdfc \gset
insert into card_groups (card_id, group_id) values (:'hdfc', :'g');
select test.throws(format($$ insert into cards (owner_id, nickname, last_four) values (%L, 'Full', '4111111111111111') $$, :'heet'),
                   '%check constraint%', 'full card number can never be stored');
select test.throws(format($$ insert into cards (owner_id, nickname, last_four) values (%L, 'Not mine', '9999') $$, :'rahul'),
                   '%row-level security%', 'cannot add a card for someone else');
select test.throws(format($$ insert into card_groups (card_id, group_id) values (%L, %L) $$, :'hdfc', :'og'),
                   '%row-level security%', 'cannot share card into a group you are not in');

select test.login(:'rahul');
insert into cards (owner_id, nickname, bank_name, last_four) values (:'rahul', 'SBI SimplyClick', 'SBI', '5678') returning id as sbi \gset
insert into card_groups (card_id, group_id) values (:'sbi', :'g');
select test.throws(format($$ insert into card_groups (card_id, group_id) values (%L, %L) $$, :'hdfc', :'g'),
                   '%row-level security%', 'cannot share someone else''s card');
select test.eq((select count(*) from cards), 2::bigint, 'group mate sees both shared cards');

select test.login(:'outsider');
insert into cards (owner_id, nickname, last_four) values (:'outsider', 'Axis', '0001') returning id as axis \gset
insert into card_groups (card_id, group_id) values (:'axis', :'og');
select test.eq((select count(*) from cards), 1::bigint, 'outsider sees only own card');

-- ---------------------------------------------------------------- blueprint example
-- Amit buys ₹5,000 on Heet's card, Karan ₹3,000 on Rahul's card, Heet ₹2,000 on own card.
select test.login(:'amit');
select save_transaction(null, :'g', :'hdfc', null, :'amit', 'Amazon', '', 'shopping', '2026-11-02', 5000,
  'equal', jsonb_build_array(jsonb_build_object('user_id', :'amit', 'amount', 5000))) as t_amazon \gset
select test.login(:'karan');
select save_transaction(null, :'g', :'sbi', null, :'karan', 'Flipkart', '', 'shopping', '2026-11-03', 3000,
  'equal', jsonb_build_array(jsonb_build_object('user_id', :'karan', 'amount', 3000))) as t_flip \gset
select test.login(:'heet');
select save_transaction(null, :'g', :'hdfc', null, :'heet', 'Restaurant', '', 'food', '2026-11-04', 2000,
  'equal', jsonb_build_array(jsonb_build_object('user_id', :'heet', 'amount', 2000))) as t_rest \gset

select test.eq((select paid_by from transactions where id = :'t_amazon'), :'heet'::uuid, 'card charge is paid by the card owner');
select test.eq(test.owes(:'g', :'amit', :'heet'), 5000.00, 'Amit owes Heet 5,000');
select test.eq(test.owes(:'g', :'karan', :'rahul'), 3000.00, 'Karan owes Rahul 3,000');
select test.eq((select count(*) from group_balances(:'g')), 2::bigint, 'own purchase on own card creates no debt');

-- Shared ₹6,000 on Heet's card: Heet, Amit, Rahul 2,000 each
select save_transaction(null, :'g', :'hdfc', null, :'heet', 'Hotel', '', 'travel', '2026-11-05', 6000, 'equal',
  jsonb_build_array(jsonb_build_object('user_id', :'heet', 'amount', 2000),
                    jsonb_build_object('user_id', :'amit', 'amount', 2000),
                    jsonb_build_object('user_id', :'rahul', 'amount', 2000))) as t_hotel \gset
select test.eq(test.owes(:'g', :'amit', :'heet'), 7000.00, 'Amit now owes Heet 7,000');
select test.eq(test.owes(:'g', :'rahul', :'heet'), 2000.00, 'Rahul owes Heet 2,000');

-- ₹100 split three ways on Rahul's card – pairwise netting with Heet
select test.login(:'rahul');
select save_transaction(null, :'g', :'sbi', null, null, 'Chai & snacks', 'unknown buyer', 'food', '2026-11-05', 100, 'equal',
  jsonb_build_array(jsonb_build_object('user_id', :'heet', 'amount', 33.34),
                    jsonb_build_object('user_id', :'amit', 'amount', 33.33),
                    jsonb_build_object('user_id', :'rahul', 'amount', 33.33))) as t_chai \gset
select test.eq((select sum(amount) from transaction_splits where transaction_id = :'t_chai'), 100.00, '100 split three ways totals exactly 100');
select test.eq(test.owes(:'g', :'rahul', :'heet'), 1966.66, 'Rahul↔Heet debts are netted (2000 − 33.34)');
select test.eq(test.owes(:'g', :'amit', :'rahul'), 33.33, 'Amit owes Rahul 33.33');
select test.eq((select purchased_by from transactions where id = :'t_chai'), null::uuid, 'unknown purchaser allowed');

-- Cash expense paid by Amit
select test.login(:'amit');
select save_transaction(null, :'g', null, null, :'amit', 'Petrol', '', 'fuel', '2026-11-06', 900, 'equal',
  jsonb_build_array(jsonb_build_object('user_id', :'amit', 'amount', 300),
                    jsonb_build_object('user_id', :'karan', 'amount', 300),
                    jsonb_build_object('user_id', :'heet', 'amount', 300))) as t_petrol \gset
select test.eq((select paid_by from transactions where id = :'t_petrol'), :'amit'::uuid, 'cash expense is paid by the payer');
select test.eq(test.owes(:'g', :'amit', :'heet'), 6700.00, 'Amit↔Heet netted with cash expense (7000 − 300)');
select test.eq(test.owes(:'g', :'karan', :'amit'), 300.00, 'Karan owes Amit 300');

-- ---------------------------------------------------------------- validation
select test.throws(format($$ select save_transaction(null, %L, %L, null, null, 'X', '', 'other', null, 100, 'exact',
  '[{"user_id": %s, "amount": 60}, {"user_id": %s, "amount": 30}]'::jsonb) $$, :'g', :'hdfc', to_json(:'heet'::text), to_json(:'amit'::text)),
  '%add up to%', 'splits must add up to the amount');
select test.throws(format($$ select save_transaction(null, %L, %L, null, null, 'X', '', 'other', null, 100, 'exact',
  '[{"user_id": %s, "amount": 50}, {"user_id": %s, "amount": 50}]'::jsonb) $$, :'g', :'hdfc', to_json(:'heet'::text), to_json(:'heet'::text)),
  '%appears twice%', 'same person twice in a split rejected');
select test.throws(format($$ select save_transaction(null, %L, %L, null, null, 'X', '', 'other', null, 100, 'exact',
  '[{"user_id": %s, "amount": 100}]'::jsonb) $$, :'g', :'hdfc', to_json(:'outsider'::text)),
  '%must be a member%', 'non-member cannot be in a split');
select test.throws(format($$ select save_transaction(null, %L, %L, null, null, 'X', '', 'other', null, 100, 'exact',
  '[{"user_id": %s, "amount": 100}]'::jsonb) $$, :'g', :'axis', to_json(:'amit'::text)),
  '%not shared with this group%', 'card not shared with the group cannot be used');
select test.throws(format($$ select save_transaction(null, %L, null, null, null, 'X', '', 'other', null, 10.005, 'exact',
  '[{"user_id": %s, "amount": 10.005}]'::jsonb) $$, :'g', to_json(:'amit'::text)),
  '%valid amount%', 'amounts with more than 2 decimals rejected');
select test.throws(format($$ select save_transaction(null, %L, null, null, null, 'X', '', 'other', null, 100, 'exact', '[]'::jsonb) $$, :'g'),
  '%who shares%', 'empty split rejected');

select test.login(:'outsider');
select test.throws(format($$ select save_transaction(null, %L, null, null, null, 'X', '', 'other', null, 100, 'exact',
  '[{"user_id": %s, "amount": 100}]'::jsonb) $$, :'g', to_json(:'outsider'::text)),
  '%not a member%', 'outsider cannot add expenses to the group');
select test.eq((select count(*) from transactions), 0::bigint, 'outsider sees no transactions');
select test.eq((select count(*) from transaction_splits), 0::bigint, 'outsider sees no splits');
select test.throws(format($$ select group_balances(%L) $$, :'g'), '%not a member%', 'outsider cannot read balances');

-- ---------------------------------------------------------------- edit & delete permissions
select test.login(:'amit');
select test.throws(format($$ select save_transaction(%L, %L, %L, null, %L, 'Flipkart', '', 'shopping', null, 1, 'equal',
  '[{"user_id": %s, "amount": 1}]'::jsonb) $$, :'t_flip', :'g', :'sbi', :'karan', to_json(:'karan'::text)),
  '%Only the person who added%', 'others cannot edit someone else''s expense');
select test.throws(format($$ select delete_transaction(%L) $$, :'t_flip'), '%Only the person who added%', 'others cannot delete it');

-- Rahul (card owner) corrects the Flipkart amount to 2,500
select test.login(:'rahul');
select save_transaction(:'t_flip', :'g', :'sbi', null, :'karan', 'Flipkart', 'corrected', 'shopping', '2026-11-03', 2500, 'equal',
  jsonb_build_array(jsonb_build_object('user_id', :'karan', 'amount', 2500)));
select test.eq(test.owes(:'g', :'karan', :'rahul'), 2500.00, 'card owner edited the amount');
select test.eq((select count(*) from transaction_splits where transaction_id = :'t_flip'), 1::bigint, 'old splits replaced on edit');

-- Karan (who added it) deletes it; it no longer counts
select test.login(:'karan');
select delete_transaction(:'t_flip');
select test.eq(test.owes(:'g', :'karan', :'rahul'), 0::numeric, 'deleted expense no longer counts');
select test.eq((select count(*) from transactions where id = :'t_flip'), 1::bigint, 'deleted expense is kept for history');

-- ---------------------------------------------------------------- direct table writes are blocked
select test.throws(format($$ insert into transactions (group_id, paid_by, created_by, merchant, amount)
  values (%L, %L, %L, 'hack', 1) $$, :'g', :'karan', :'karan'), '%permission denied%', 'no direct insert into transactions');
select test.throws(format($$ update transactions set amount = 1 where id = %L $$, :'t_amazon'),
  '%permission denied%', 'no direct update of transactions');
select test.throws(format($$ insert into settlements (group_id, from_user, to_user, amount, created_by)
  values (%L, %L, %L, 1, %L) $$, :'g', :'karan', :'amit', :'karan'), '%permission denied%', 'no direct insert into settlements');
select test.throws(format($$ select * from _pair_balances(%L) $$, :'g'), '%permission denied%', 'internal function not callable');
select test.throws($$ update profiles set email = 'x@y.z' $$, '%permission denied%', 'email cannot be changed from the app');
update profiles set upi_id = 'karan@okaxis' where id = :'karan';
select test.eq((select upi_id from profiles where id = :'karan'), 'karan@okaxis', 'user can set own UPI ID');

-- ---------------------------------------------------------------- settlements
select test.login(:'karan');
select test.throws(format($$ select add_settlement(%L, %L, %L, 100, 'upi', '') $$, :'g', :'amit', :'heet'),
  '%only record payments you made or received%', 'cannot record a payment between two other people');

select test.login(:'amit');
select add_settlement(:'g', :'amit', :'heet', 2000, 'upi', 'part payment') as s1 \gset
select test.eq(test.owes(:'g', :'amit', :'heet'), 4700.00, 'partial payment reduces the debt');

select test.login(:'heet');
select delete_settlement(:'s1');
select test.eq(test.owes(:'g', :'amit', :'heet'), 6700.00, 'receiver can undo a wrong payment');

select test.login(:'amit');
select add_settlement(:'g', :'amit', :'heet', 6700, 'upi', '') ;
select test.eq(test.owes(:'g', :'amit', :'heet'), 0::numeric, 'full payment settles the pair');
select add_settlement(:'g', :'amit', :'rahul', 50, 'cash', 'overpaid');
select test.eq(test.owes(:'g', :'rahul', :'amit'), 16.67, 'overpayment flips the direction');

-- ---------------------------------------------------------------- my_balances
select test.login(:'heet');
select test.eq((select amount from my_balances() where other_user = :'rahul'), 1966.66, 'my_balances: Rahul owes me');
select test.eq((select amount from my_balances() where other_user = :'karan'), null::numeric, 'my_balances: settled people not listed');
select test.login(:'karan');
select test.eq((select amount from my_balances() where other_user = :'amit'), -300.00, 'my_balances: negative = I owe');

-- ---------------------------------------------------------------- leaving a group
select test.throws(format($$ select leave_group(%L) $$, :'g'), '%Settle all your balances%', 'cannot leave while owing money');
select add_settlement(:'g', :'karan', :'amit', 300, 'cash', '');
select leave_group(:'g');
select test.eq((select count(*) from groups), 0::bigint, 'after leaving, the group is hidden');

select test.login(:'heet');
select test.eq((select is_active from group_members where group_id = :'g' and user_id = :'karan'), false, 'membership kept as inactive');
select test.eq((select full_name from profiles where id = :'karan'), 'karan', 'former member name still visible for history');
select test.throws(format($$ select save_transaction(null, %L, %L, null, null, 'X', '', 'other', null, 10, 'exact',
  '[{"user_id": %s, "amount": 10}]'::jsonb) $$, :'g', :'hdfc', to_json(:'karan'::text)),
  '%must be a member%', 'former member cannot be added to new splits');

select test.login(:'karan');
select join_group(:'code');
select test.eq((select is_active from group_members where group_id = :'g' and user_id = :'karan'), true, 'can re-join with the code');

-- ---------------------------------------------------------------- unsharing a card
select test.login(:'heet');
delete from card_groups where card_id = :'hdfc' and group_id = :'g';
select test.throws(format($$ select save_transaction(null, %L, %L, null, null, 'X', '', 'other', null, 10, 'exact',
  '[{"user_id": %s, "amount": 10}]'::jsonb) $$, :'g', :'hdfc', to_json(:'heet'::text)),
  '%not shared with this group%', 'unshared card cannot take new charges');
select test.login(:'amit');
select test.eq((select count(*) from cards where id = :'hdfc'), 1::bigint, 'old charges still show the unshared card');
-- editing an old charge on the unshared card still works
select test.login(:'heet');
select save_transaction(:'t_rest', :'g', :'hdfc', null, :'heet', 'Restaurant', 'edited', 'food', '2026-11-04', 2000, 'equal',
  jsonb_build_array(jsonb_build_object('user_id', :'heet', 'amount', 2000)));
select test.eq((select note from transactions where id = :'t_rest'), 'edited', 'old charge on unshared card is still editable');

-- ---------------------------------------------------------------- admin & activity
select test.login(:'amit');
select test.throws(format($$ select regenerate_invite_code(%L) $$, :'g'), '%Only a group admin%', 'members cannot reset the invite code');
update groups set name = 'Hacked' where id = :'g';
select test.eq((select name from groups where id = :'g'), 'Ahmedabad Friends', 'members cannot rename the group');
select test.login(:'heet');
select regenerate_invite_code(:'g') as code2 \gset
select test.eq(:'code2' <> :'code', true, 'admin got a new invite code');
select test.eq((select count(*) > 10 from activity where group_id = :'g'), true, 'activity feed recorded actions');

-- ---------------------------------------------------------------- anonymous visitors
reset role;
set role anon;
select test.throws($$ select * from profiles $$, '%permission denied%', 'anon cannot read profiles');
select test.throws($$ select create_group('x') $$, '%permission denied%', 'anon cannot call app functions');
reset role;

\echo 'All CardMates database tests passed.'
