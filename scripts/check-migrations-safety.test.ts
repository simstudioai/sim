/**
 * Run with: bun test scripts/check-migrations-safety.test.ts
 * (Root scripts are bun-native and not part of the turbo/vitest workspaces.)
 */
import { describe, expect, test } from 'bun:test'
import { lintSql } from './check-migrations-safety.ts'

const rules = (sql: string) => lintSql(sql).map((f) => `${f.tier}:${f.rule}`)

describe('additive / safe', () => {
  test('nullable add column passes', () => {
    expect(lintSql('ALTER TABLE "webhook" ADD COLUMN "provider_config" json;')).toEqual([])
  })

  test('NOT NULL with DEFAULT passes', () => {
    expect(lintSql('ALTER TABLE "user" ADD COLUMN "flag" boolean DEFAULT false NOT NULL;')).toEqual(
      []
    )
  })

  test('CREATE TABLE plus index and FK on that new table passes', () => {
    const sql = `CREATE TABLE "kb" ("id" text PRIMARY KEY NOT NULL, "user_id" text NOT NULL);
--> statement-breakpoint
CREATE INDEX "kb_user_id_idx" ON "kb" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "kb" ADD CONSTRAINT "kb_user_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id");`
    expect(lintSql(sql)).toEqual([])
  })

  test('CONCURRENTLY index after a COMMIT breakpoint passes', () => {
    const sql = `COMMIT;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_x" ON "embedding" ("kb_id");`
    expect(lintSql(sql)).toEqual([])
  })
})

describe('hard errors', () => {
  test('ADD COLUMN NOT NULL without default', () => {
    expect(rules('ALTER TABLE "user" ADD COLUMN "email" text NOT NULL;')).toEqual([
      'error:add-not-null-no-default',
    ])
  })

  test('RENAME column', () => {
    expect(rules('ALTER TABLE "marketplace" RENAME COLUMN "executions" TO "views";')).toEqual([
      'error:rename',
    ])
  })

  test('CREATE INDEX on existing table without CONCURRENTLY', () => {
    expect(rules('CREATE INDEX "idx_y" ON "embedding" ("kb_id");')).toEqual([
      'error:index-not-concurrent',
    ])
  })

  test('CONCURRENTLY index without IF NOT EXISTS', () => {
    const sql = `COMMIT;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "idx_z" ON "embedding" ("kb_id");`
    expect(rules(sql)).toEqual(['error:concurrent-index-not-idempotent'])
  })

  test('CONCURRENTLY index without a preceding COMMIT', () => {
    expect(
      rules('CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_z" ON "embedding" ("kb_id");')
    ).toEqual(['error:concurrent-index-no-commit'])
  })

  test('ADD FOREIGN KEY on existing table without NOT VALID', () => {
    expect(
      rules(
        'ALTER TABLE "session" ADD CONSTRAINT "s_fk" FOREIGN KEY ("uid") REFERENCES "user"("id");'
      )
    ).toEqual(['error:constraint-not-valid'])
  })
})

describe('annotate tier', () => {
  const drop = 'ALTER TABLE "webhook" DROP COLUMN "secret";'

  test('DROP COLUMN unannotated fails', () => {
    expect(rules(drop)).toEqual(['error:drop-column'])
  })

  test('DROP COLUMN annotated passes', () => {
    const sql = `-- migration-safe: secret read removed in v0.6.1 (#1234), shipped two deploys ago\n${drop}`
    expect(lintSql(sql)).toEqual([])
  })

  test('annotation tolerates an intervening statement-breakpoint line', () => {
    const sql = `ALTER TABLE "webhook" ADD COLUMN "provider_config" json;
--> statement-breakpoint
-- migration-safe: secret read removed in v0.6.1 (#1234)
${drop}`
    expect(lintSql(sql)).toEqual([])
  })

  test('dangling annotation with empty reason fails', () => {
    const sql = `-- migration-safe:\n${drop}`
    const found = lintSql(sql)
    expect(found).toHaveLength(1)
    expect(found[0].tier).toBe('error')
    expect(found[0].message).toContain('no reason')
  })

  test('annotation on the wrong statement does not bleed', () => {
    const sql = `-- migration-safe: removing secret
ALTER TABLE "webhook" ADD COLUMN "x" json;
--> statement-breakpoint
${drop}`
    expect(rules(sql)).toEqual(['error:drop-column'])
  })

  test('type change and DROP TABLE are annotate-tier', () => {
    expect(
      rules(
        'ALTER TABLE "user_table_rows" ALTER COLUMN "order_key" SET DATA TYPE text COLLATE "C";'
      )
    ).toEqual(['error:alter-type'])
    expect(rules('DROP TABLE "marketplace_execution" CASCADE;')).toEqual(['error:drop-table'])
  })
})

describe('warnings (non-blocking)', () => {
  test('UPDATE backfill warns but does not error', () => {
    const found = lintSql('UPDATE "user_table_definitions" SET "schema" = \'{}\' WHERE id = \'1\';')
    expect(found.map((f) => f.tier)).toEqual(['warn'])
  })

  test('UPDATE without WHERE flags the whole-table note', () => {
    const found = lintSql('UPDATE "user" SET "active" = true;')
    expect(found[0].tier).toBe('warn')
    expect(found[0].message).toContain('no WHERE')
  })
})

describe('review fixes', () => {
  test('RENAME CONSTRAINT is metadata-only — not flagged', () => {
    expect(
      lintSql('ALTER TABLE "permission_group" RENAME CONSTRAINT "old_fk" TO "new_fk";')
    ).toEqual([])
  })

  test('ALTER INDEX ... RENAME is metadata-only — not flagged', () => {
    expect(lintSql('ALTER INDEX "old_idx" RENAME TO "new_idx";')).toEqual([])
  })

  test('table RENAME TO is still a hard error', () => {
    expect(rules('ALTER TABLE "marketplace" RENAME TO "listings";')).toEqual(['error:rename'])
  })

  test('plain DROP INDEX is a hard error (ACCESS EXCLUSIVE lock)', () => {
    expect(rules('DROP INDEX "permission_group_workspace_name_unique";')).toEqual([
      'error:drop-index-not-concurrent',
    ])
  })

  test('DROP INDEX CONCURRENTLY after a COMMIT passes clean', () => {
    const sql = `COMMIT;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "stale_idx";`
    expect(lintSql(sql)).toEqual([])
  })

  test('DROP INDEX CONCURRENTLY without IF EXISTS is not idempotent', () => {
    const sql = `COMMIT;
--> statement-breakpoint
DROP INDEX CONCURRENTLY "stale_idx";`
    expect(rules(sql)).toEqual(['error:concurrent-drop-index-not-idempotent'])
  })

  test('DROP INDEX CONCURRENTLY without a preceding COMMIT errors', () => {
    expect(rules('DROP INDEX CONCURRENTLY IF EXISTS "stale_idx";')).toEqual([
      'error:concurrent-drop-index-no-commit',
    ])
  })

  test('alter-type does not match TYPE inside a string default', () => {
    expect(lintSql(`ALTER TABLE "x" ALTER COLUMN "y" SET DEFAULT 'change TYPE later';`)).toEqual([])
  })
})

describe('parser robustness', () => {
  test('semicolon inside a string literal does not split', () => {
    expect(lintSql(`ALTER TABLE "x" ADD COLUMN "y" text DEFAULT 'a;b' NOT NULL;`)).toEqual([])
  })

  test('dollar-quoted DO block is one statement; FK on a new table is suppressed', () => {
    const sql = `CREATE TABLE "jobs" ("id" text PRIMARY KEY NOT NULL, "wid" text NOT NULL);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "jobs" ADD CONSTRAINT "jobs_fk" FOREIGN KEY ("wid") REFERENCES "workspace"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;`
    expect(lintSql(sql)).toEqual([])
  })
})
