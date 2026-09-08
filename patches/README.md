# Dependency patches

`drizzle-kit@0.31.10.patch` makes PostgreSQL schema push failures exit with status 1. Upstream catches SQL errors and then exits successfully, allowing the `db:push` policy-reconciliation step to run against an incomplete schema. The patch preserves the SQL error and stops immediately, matching the other database push handlers.

Verified against a local PostgreSQL connection with `default_transaction_read_only=on`: a schema write fails and policy reconciliation is never invoked. Remove this patch when an upgraded Drizzle Kit propagates PostgreSQL push failures correctly.
