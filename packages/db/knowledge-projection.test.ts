import { readFileSync } from 'node:fs'
import { SYNC_EMBEDDING_SEARCH_FUNCTION } from '@sim/db/knowledge-projection'
import { describe, expect, it } from 'vitest'

const normalized = (text: string) => text.replace(/\s+/g, ' ').trim()

describe('sync_embedding_search installers', () => {
  it('keeps migration 0449 and the provisioning paths on the same function', () => {
    const migration = readFileSync(
      new URL('./migrations/0449_retire_search_projection_writes.sql', import.meta.url),
      'utf8'
    )
    const statement = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION'))
    expect(
      normalized(statement.replace('"public"."sync_embedding_search"', 'sync_embedding_search'))
    ).toBe(normalized(`${SYNC_EMBEDDING_SEARCH_FUNCTION};`))
  })
})
