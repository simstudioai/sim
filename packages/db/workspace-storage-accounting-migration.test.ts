/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { omit } from '@sim/utils/object'
import { describe, expect, it } from 'vitest'

const schemaMigration = readFileSync(
  new URL('./migrations/0260_clean_agent_brand.sql', import.meta.url),
  'utf8'
)

function readIndexMigration(): string {
  return readFileSync(
    new URL('./migrations/0261_concurrent_large_table_indexes.sql', import.meta.url),
    'utf8'
  )
}

function splitStatements(migration: string): string[] {
  return migration
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

describe('workspace storage accounting migration', () => {
  it('keeps 0260 limited to its four additive transactional schema statements', () => {
    expect(splitStatements(schemaMigration)).toEqual([
      'ALTER TABLE "paused_executions" ADD COLUMN "automatic_resume_retry_count" integer DEFAULT 0 NOT NULL;',
      'ALTER TABLE "workspace" ADD COLUMN "storage_used_bytes" bigint DEFAULT 0 NOT NULL;',
      'ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "organization_assigned_at" timestamp;',
      'ALTER TABLE "workspace" ADD CONSTRAINT "workspace_storage_used_bytes_non_negative" CHECK ("workspace"."storage_used_bytes" >= 0) NOT VALID;',
    ])
    expect(schemaMigration).not.toMatch(/\b(COMMIT|CREATE INDEX|DROP INDEX|CREATE TRIGGER)\b/)
    expect(schemaMigration).not.toContain('RETURNS trigger')
  })

  it('keeps the three large-table indexes in a replay-safe post-commit migration', () => {
    expect(splitStatements(readIndexMigration())).toEqual([
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

  it('journals 0261 as a custom migration and preserves the snapshot chain', () => {
    const journal = JSON.parse(
      readFileSync(new URL('./migrations/meta/_journal.json', import.meta.url), 'utf8')
    ) as {
      entries: Array<{
        breakpoints: boolean
        idx: number
        tag: string
        version: string
        when: number
      }>
    }
    const previousSnapshot = JSON.parse(
      readFileSync(new URL('./migrations/meta/0260_snapshot.json', import.meta.url), 'utf8')
    ) as Record<string, unknown> & { id: string; prevId: string }
    const customSnapshot = JSON.parse(
      readFileSync(new URL('./migrations/meta/0261_snapshot.json', import.meta.url), 'utf8')
    ) as Record<string, unknown> & { id: string; prevId: string }

    expect(journal.entries.filter(({ idx }) => idx === 261)).toEqual([
      {
        breakpoints: true,
        idx: 261,
        tag: '0261_concurrent_large_table_indexes',
        version: '7',
        when: expect.any(Number),
      },
    ])
    expect(customSnapshot.prevId).toBe(previousSnapshot.id)

    const previousSchema = omit(previousSnapshot, ['id', 'prevId'])
    const customSchema = omit(customSnapshot, ['id', 'prevId'])
    expect(customSchema).toEqual(previousSchema)
  })

  it('does not install payer-transfer or delete triggers in either migration', () => {
    const deployMigrations = `${schemaMigration}\n${readIndexMigration()}`
    expect(deployMigrations).not.toContain('CREATE TRIGGER')
    expect(deployMigrations).not.toContain('RETURNS trigger')
    expect(deployMigrations).not.toContain('transfer_workspace_storage_on_payer_change')
    expect(deployMigrations).not.toContain('subtract_workspace_storage_on_delete')
  })
})
