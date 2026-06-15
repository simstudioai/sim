---
name: db-migrate
description: Author or review a Drizzle DB migration for zero-downtime safety — expand/contract phasing, backward-compatibility with the deployed app version, and writing the `-- migration-safe` acknowledgment the check:migrations lint requires. Use when adding/editing files under `packages/db/migrations/` or changing `packages/db/schema.ts`.
---

# DB Migrate Skill

You make schema changes that survive a deploy without downtime. The `check:migrations` lint (`scripts/check-migrations-safety.ts`) is the deterministic gate; you are the judgment that decides whether a flagged change is actually safe and writes the annotation that satisfies it.

## The window (why this matters)

A deploy runs the migration, then rolls out the new app image via blue/green. The two are **not atomic and cannot be** — during cutover the old task set keeps serving against the **already-migrated** schema. So:

> Every migration must be backward-compatible with the app version that is *already deployed*.

If a migration drops a column the old code still reads, renames one, or adds a `NOT NULL` the old inserts don't populate, the old code throws until traffic fully shifts — the downtime we're guarding against. You can't fix this by reordering the pipeline; the only fix is discipline.

## Expand / contract

Split every breaking change across **two deploys**:

1. **Expand** (this PR): additive, backward-compatible schema + code that tolerates *both* the old and new shape.
2. **Contract** (a later PR, after expand is fully deployed): remove the old thing, now that nothing reads it.

Never put expand and contract in the same PR. If this PR both removes the code that used a column *and* drops the column, the old code is still live during cutover — split it.

### Per-operation playbook

| You want to | Do (deploy 1 = expand) | Do (deploy 2 = contract) |
|---|---|---|
| Add a required column | `ADD COLUMN` nullable or `DEFAULT`; code writes it | backfill, then `SET NOT NULL` |
| Rename a column/table | add the new name; code dual-writes / reads new-then-old | drop the old name |
| Drop a column/table | stop all reads/writes in code; ship it | `DROP` (annotate) |
| Change a column type | add a new column of the new type; dual-write | backfill, swap reads, drop old |
| Add FK / CHECK | `ADD CONSTRAINT ... NOT VALID` | `VALIDATE CONSTRAINT` separately |
| Index an existing table | `COMMIT;` breakpoint → `SET lock_timeout = 0` → `CREATE INDEX CONCURRENTLY IF NOT EXISTS` (see `packages/db/scripts/migrate.ts`) | — |
| Drop an index | `COMMIT;` breakpoint → `DROP INDEX CONCURRENTLY` — plain `DROP INDEX` takes ACCESS EXCLUSIVE on the table | — |
| Backfill data | batched + idempotent `UPDATE` (keyset/`WHERE`, bounded) | — |

A `CREATE INDEX`, `ADD COLUMN`, or `ADD CONSTRAINT` against a table **created in the same migration** is always safe (no rows, no live traffic) — the lint already suppresses those.

## The judgment the lint can't do

The lint flags risky *shapes*; it cannot know whether a given drop is *safe right now*. For each flagged statement, do the work it can't:

1. **Is the dependency gone?** Grep the app for the table/column: search `apps/sim` and `packages` for the column name, the Drizzle field (camelCase), and the table object. If any live read/write remains, it is **not** safe — fix the code first.
2. **Did the expand already ship?** The removal of that read/write must be in a deploy that is *already out*, not this same PR. If it's in this PR, split: land the code change now, do the destructive migration in a follow-up after it deploys.
3. **Backfills:** confirm the `UPDATE`/`DELETE` is batched (bounded `WHERE`/keyset, not a single whole-table statement), idempotent (safe to replay — a failed migration re-runs unjournaled files from the top), and safe under concurrent writes from the still-live old app.

## Workflow

1. Edit `packages/db/schema.ts`, then `cd packages/db && bunx drizzle-kit generate` to produce the SQL.
2. Hand-edit the generated SQL where the playbook requires it: `CONCURRENTLY` + `COMMIT;` breakpoint for indexes on existing tables, `NOT VALID` for constraints, batching for backfills.
3. Run `bun run check:migrations` (or `bun run scripts/check-migrations-safety.ts main` locally).
   - **Hard errors** (`add-not-null-no-default`, `rename`, `index-not-concurrent`, `constraint-not-valid`, …): rewrite into expand/contract. Do **not** try to annotate them away — the lint won't accept it.
   - **Annotate tier** (`drop-table`, `drop-column`, `drop-default`, `set-not-null`, `alter-type`, `drop-index`): only after you've confirmed steps 1–3 above, add a comment on the line directly above the statement:
     ```sql
     -- migration-safe: `secret` read removed in v0.6.1 (#1234), shipped two deploys ago
     ALTER TABLE "webhook" DROP COLUMN "secret";
     ```
     The reason must be specific and name the PR/version that removed the dependency. An empty reason fails the lint.
   - **Warnings** (`data-backfill`): non-blocking, but confirm the batching/idempotency before merging.
4. Verify locally: `cd packages/db && bun run db:migrate` against a dev DB.

## Hard rule

Never annotate a destructive statement just to make the lint pass. The annotation is a claim that you verified the old code no longer depends on it. If you can't make that claim truthfully, the change belongs in a later deploy — tell the user to split it.
