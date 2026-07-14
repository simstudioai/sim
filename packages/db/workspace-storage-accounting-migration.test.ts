/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('./migrations/0260_unknown_sinister_six.sql', import.meta.url),
  'utf8'
)

function splitStatements(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
}

describe('workspace storage accounting migration', () => {
  it('keeps every statement idempotent so an interrupted run replays from the top', () => {
    expect(splitStatements(migration)).toEqual([
      'ALTER TABLE "paused_executions" ADD COLUMN IF NOT EXISTS "automatic_resume_retry_count" integer DEFAULT 0 NOT NULL;',
      'ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "storage_used_bytes" bigint DEFAULT 0 NOT NULL;',
      'ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "organization_assigned_at" timestamp;',
      'ALTER TABLE "workspace" DROP CONSTRAINT IF EXISTS "workspace_storage_used_bytes_non_negative";',
      'ALTER TABLE "workspace" ADD CONSTRAINT "workspace_storage_used_bytes_non_negative" CHECK ("workspace"."storage_used_bytes" >= 0) NOT VALID;',
      'COMMIT;',
      'SET lock_timeout = 0;',
      'DROP INDEX CONCURRENTLY IF EXISTS "copilot_messages_user_created_at_idx";',
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "copilot_messages_user_created_at_idx" ON "copilot_messages" USING btree ("created_at","chat_id","message_id") WHERE "copilot_messages"."role" = 'user' AND "copilot_messages"."deleted_at" IS NULL;`,
      'DROP INDEX CONCURRENTLY IF EXISTS "outbox_event_type_created_idx";',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "outbox_event_type_created_idx" ON "outbox_event" USING btree ("event_type","created_at");',
      'DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_completed_ended_at_idx";',
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_completed_ended_at_idx" ON "workflow_execution_logs" USING btree ("ended_at","workspace_id","execution_id") WHERE "workflow_execution_logs"."status" = 'completed' AND "workflow_execution_logs"."level" = 'info' AND "workflow_execution_logs"."ended_at" IS NOT NULL;`,
      `SET lock_timeout = '5s';`,
    ])
  })

  it('adds the storage ledger column with a validated-later non-negative guard', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "storage_used_bytes" bigint DEFAULT 0 NOT NULL'
    )
    expect(migration).toContain('CHECK ("workspace"."storage_used_bytes" >= 0) NOT VALID')
    expect(migration).not.toContain('CREATE TABLE "workspace_storage_usage"')
  })

  it('commits transactional DDL before every concurrent index build', () => {
    const statements = splitStatements(migration)
    const commitIndex = statements.indexOf('COMMIT;')
    expect(commitIndex).toBeGreaterThan(-1)
    for (const [index, statement] of statements.entries()) {
      if (statement.includes('CONCURRENTLY')) {
        expect(index).toBeGreaterThan(commitIndex)
      }
    }
    expect(migration).not.toMatch(/(?<!CONCURRENTLY IF NOT EXISTS )CREATE INDEX (?!CONCURRENTLY)/)
  })

  it('does not install payer-transfer or delete triggers', () => {
    expect(migration).not.toContain('CREATE TRIGGER')
    expect(migration).not.toContain('RETURNS trigger')
    expect(migration).not.toContain('transfer_workspace_storage_on_payer_change')
    expect(migration).not.toContain('subtract_workspace_storage_on_delete')
  })

  it('journals the consolidated migration as the latest entry', () => {
    const journal = JSON.parse(
      readFileSync(new URL('./migrations/meta/_journal.json', import.meta.url), 'utf8')
    ) as { entries: Array<{ idx: number; tag: string }> }
    const lastEntry = journal.entries[journal.entries.length - 1]
    expect(lastEntry).toMatchObject({ idx: 261, tag: '0261_chat_include_thinking' })
  })
})
