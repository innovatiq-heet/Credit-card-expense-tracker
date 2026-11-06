export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  upi_id: string | null;
};

export type Group = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
};

export type Member = {
  group_id: string;
  user_id: string;
  role: "admin" | "member";
  is_active: boolean;
  joined_at: string;
  profile: Profile | null;
};

export type Card = {
  id: string;
  owner_id: string;
  nickname: string;
  bank_name: string;
  last_four: string;
  billing_day: number | null;
  due_day: number | null;
  is_active: boolean;
  created_at: string;
};

export type Split = { user_id: string; amount: number };

export type Txn = {
  id: string;
  group_id: string;
  card_id: string | null;
  paid_by: string;
  purchased_by: string | null;
  created_by: string;
  merchant: string;
  note: string;
  category: string;
  amount: number;
  split_method: "equal" | "exact";
  txn_date: string;
  created_at: string;
  transaction_splits: Split[];
};

export type Settlement = {
  id: string;
  group_id: string;
  from_user: string;
  to_user: string;
  amount: number;
  method: string;
  note: string;
  created_by: string;
  created_at: string;
};

/** from_user owes to_user `amount` rupees. */
export type Pair = { from_user: string; to_user: string; amount: number };

export type Activity = {
  id: number;
  group_id: string;
  actor_id: string | null;
  action: string;
  label: string;
  amount: number | null;
  created_at: string;
};

/** amount > 0 → they owe me, amount < 0 → I owe them (rupees). */
export type MyBalance = {
  group_id: string;
  group_name: string;
  other_user: string;
  other_name: string;
  other_upi: string | null;
  amount: number;
};
