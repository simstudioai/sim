/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('./migrations/0260_clean_agent_brand.sql', import.meta.url),
  'utf8'
)

describe('workspace storage accounting migration', () => {
  it('keeps the only per-workspace ledger on the workspace row', () => {
    expect(migration).toContain('ADD COLUMN "storage_used_bytes" bigint DEFAULT 0 NOT NULL')
    expect(migration).toContain('"workspace_storage_used_bytes_non_negative"')
    expect(migration).not.toContain('CREATE TABLE "workspace_storage_usage"')
  })

  it('moves personal workspace bytes to an organization payer', () => {
    expect(migration).toContain(
      "WHEN OLD.organization_id IS NOT NULL THEN 'organization:' || OLD.organization_id"
    )
    expect(migration).toContain(
      "WHEN NEW.organization_id IS NOT NULL THEN 'organization:' || NEW.organization_id"
    )
    expect(migration).toContain(
      'SET storage_used_bytes = storage_used_bytes + NEW.storage_used_bytes'
    )
    expect(migration).toContain(
      'SET storage_used_bytes = storage_used_bytes - OLD.storage_used_bytes'
    )
    expect(migration).not.toContain(
      'SET storage_used_bytes = storage_used_bytes - NEW.storage_used_bytes'
    )
  })

  it('moves organization bytes to a personal payer or between billed users', () => {
    expect(migration).toContain("ELSE 'user:' || OLD.billed_account_user_id")
    expect(migration).toContain("ELSE 'user:' || NEW.billed_account_user_id")
    expect(migration).toContain('WHERE user_id = NEW.billed_account_user_id')
  })

  it('serializes concurrent transfers using deterministic payer locks', () => {
    const leastLock = migration.indexOf(
      "hashtextextended('workspace-storage-payer:' || LEAST(old_payer_key, new_payer_key), 0)"
    )
    const greatestLock = migration.indexOf(
      "hashtextextended('workspace-storage-payer:' || GREATEST(old_payer_key, new_payer_key), 0)"
    )
    expect(leastLock).toBeGreaterThan(-1)
    expect(greatestLock).toBeGreaterThan(leastLock)
    expect(migration).toContain(
      'AFTER UPDATE OF "organization_id", "billed_account_user_id" ON "workspace"'
    )
  })

  it('subtracts from the post-transfer payer on workspace deletion', () => {
    expect(migration).toContain('CREATE TRIGGER "workspace_storage_workspace_delete"')
    expect(migration).toContain(
      'SET storage_used_bytes = storage_used_bytes - OLD.storage_used_bytes'
    )
    expect(migration).toContain('WHERE id = OLD.organization_id')
    expect(migration).toContain('WHERE user_id = OLD.billed_account_user_id')
  })

  it('rolls back transfers on missing or underfunded live payer rows', () => {
    expect(migration).toContain('IF old_payer_exists AND affected_rows <> 1 THEN')
    expect(migration).toContain('RAISE EXCEPTION')
    expect(migration).toContain('AND storage_used_bytes >= OLD.storage_used_bytes')
  })

  it('does not strand the old balance when payer and workspace bytes change together', () => {
    expect(migration).toContain(
      'OR (OLD.storage_used_bytes = 0 AND NEW.storage_used_bytes = 0) THEN'
    )
    expect(migration).not.toContain('OR NEW.storage_used_bytes = 0 THEN')
  })
})
