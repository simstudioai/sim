import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { appPreviewSession, appReleaseAction, appRevisionAction } from './schema'

describe('app preview promotion schema', () => {
  it('stores action safety and bounded active preview roles', () => {
    for (const table of [appRevisionAction, appReleaseAction]) {
      const readOnly = getTableConfig(table).columns.find((column) => column.name === 'read_only')
      expect(readOnly?.notNull).toBe(true)
      expect(readOnly?.default).toBe(false)
    }

    const preview = getTableConfig(appPreviewSession)
    expect(preview.columns.find((column) => column.name === 'lifecycle')?.default).toBe('primary')
    expect(preview.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'app_preview_session_active_user_project_unique',
        'app_preview_session_active_candidate_user_project_unique',
        'app_preview_session_active_displaced_user_project_unique',
      ])
    )
    expect(preview.checks.map((check) => check.name)).toContain(
      'app_preview_session_lifecycle_check'
    )
  })

  it('uses the next migration after durable publish operation 0272', () => {
    const migrationPath = fileURLToPath(
      new URL('./migrations/0273_app_preview_promotion_confirmation.sql', import.meta.url)
    )
    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('ADD COLUMN "read_only" boolean DEFAULT false NOT NULL')
    expect(sql).toContain('CREATE UNIQUE INDEX CONCURRENTLY')
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i)
  })
})
