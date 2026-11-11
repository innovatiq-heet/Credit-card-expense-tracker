export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  upi_id: string | null;
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

export type Group = {
  id: string;
  name: string;
  created_at: string;
};

/** Someone in a group – just a name, no account. */
export type Person = {
  id: string;
  group_id: string;
  name: string;
  phone: string | null;
  created_at: string;
};

/** person_id null = your own share. */
export type Share = { person_id: string | null; amount: number };

/** Always paid by you (card_id null = cash / UPI). */
export type Expense = {
  id: string;
  group_id: string;
  card_id: string | null;
  merchant: string;
  note: string;
  category: string;
  amount: number;
  split_method: "equal" | "exact";
  txn_date: string;
  created_at: string;
  updated_at: string;
  expense_shares: Share[];
};

/** Money a person paid back to you. */
export type Payment = {
  id: string;
  group_id: string;
  person_id: string;
  amount: number;
  method: string;
  note: string;
  paid_on: string;
  created_at: string;
};

/** balance > 0 → they still owe you (rupees). */
export type PersonBalance = {
  person_id: string;
  group_id: string;
  name: string;
  phone: string | null;
  owed: number;
  paid: number;
  balance: number;
};
