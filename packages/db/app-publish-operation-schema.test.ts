import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { appPublishOperation } from './schema'

describe('app_publish_operation schema', () => {
  it('persists resumable stage outputs and lease state', () => {
    const config = getTableConfig(appPublishOperation)
    expect(config.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'project_id',
        'source_revision_id',
        'stage',
        'deployments',
        'rebound_revision_id',
        'build_id',
        'release_id',
        'lease_token',
        'lease_expires_at',
        'completed_at',
      ])
    )
    expect(config.checks.map((check) => check.name)).toContain('app_publish_operation_stage_check')
  })

  it('ships as an additive create-table migration', () => {
    const migrationPath = fileURLToPath(
      new URL('./migrations/0272_app_publish_operation.sql', import.meta.url)
    )
    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('CREATE TABLE "app_publish_operation"')
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i)
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i)
  })
})
