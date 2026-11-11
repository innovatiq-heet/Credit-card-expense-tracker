#!/usr/bin/env bash
# Runs supabase/schema.sql + tests against a throwaway local PostgreSQL database.
# Needs a local Postgres (psql). Override connection with PG* env vars if needed.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="cardmates_test_$$"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1 && [ -z "${PGHOST:-}" ]; then
  RUN=(su postgres -c)          # local root: talk to Postgres as the postgres user
else
  RUN=(bash -c)
fi

"${RUN[@]}" "createdb $DB"
trap '"${RUN[@]}" "dropdb --if-exists $DB" >/dev/null 2>&1 || true' EXIT

# schema.sql runs twice to prove it can be re-run safely
for f in supabase/tests/mock_supabase.sql supabase/schema.sql supabase/schema.sql supabase/tests/scenarios.sql; do
  "${RUN[@]}" "${PSQL[*]} -d $DB" < "$f"
done
