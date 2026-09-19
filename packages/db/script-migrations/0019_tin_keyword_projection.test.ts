/**
 * @vitest-environment node
 */
import type { Sql } from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import { installTinKeywordProjection } from './0019_tin_keyword_projection'
import { ScriptMigrationDeferred } from './types'

/** A session that offers `tin` or not, and answers `CREATE EXTENSION` with `createError`. */
function createSqlHarness(options: { available: boolean; createError?: { code: string } }) {
  const statements: string[] = []
  const run = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim()
    statements.push(text)
    if (text.includes('pg_available_extensions')) {
      return Promise.resolve(options.available ? [{ '?column?': 1 }] : [])
    }
    return Promise.resolve([])
  }
  const sql = run as unknown as Sql
  sql.unsafe = vi.fn(async (text: string) => {
    statements.push(text)
    if (text.startsWith('CREATE EXTENSION') && options.createError) throw options.createError
    return []
  }) as unknown as Sql['unsafe']
  return { sql, statements }
}

describe('installTinKeywordProjection', () => {
  it('records a no-op where the database does not offer tin', async () => {
    const { sql, statements } = createSqlHarness({ available: false })
    expect(await installTinKeywordProjection(sql)).toBeUndefined()
    expect(statements.some((text) => text.startsWith('CREATE EXTENSION'))).toBe(false)
  })

  it.each(['42501', '0A000'])(
    'defers without installing anything when the database refuses the extension (%s)',
    async (code) => {
      const { sql, statements } = createSqlHarness({ available: true, createError: { code } })
      await expect(installTinKeywordProjection(sql)).rejects.toBeInstanceOf(ScriptMigrationDeferred)
      expect(statements.at(-1)).toBe('CREATE EXTENSION IF NOT EXISTS tin')
    }
  )

  it('fails the migration on any other extension error', async () => {
    const { sql } = createSqlHarness({ available: true, createError: { code: '53100' } })
    await expect(installTinKeywordProjection(sql)).rejects.toEqual({ code: '53100' })
  })
})
