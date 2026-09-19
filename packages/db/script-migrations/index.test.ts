/**
 * @vitest-environment node
 */
import type { Sql } from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import { runScriptMigrations, scriptMigrations } from './index'

const TIN = '0019_tin_keyword_projection'

/** A session where every migration but Tin's is recorded and the database refuses `tin`. */
function createSqlHarness() {
  const recorded: string[] = []
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim()
    if (text.startsWith('SELECT name FROM script_migrations')) {
      return Promise.resolve(
        scriptMigrations.filter(({ name }) => name !== TIN).map(({ name }) => ({ name }))
      )
    }
    if (text.includes('pg_available_extensions')) return Promise.resolve([{ '?column?': 1 }])
    if (text.startsWith('INSERT INTO script_migrations')) recorded.push(values[0] as string)
    return Promise.resolve([])
  }
  const sql = run as unknown as Sql
  sql.unsafe = vi.fn(async (text: string) => {
    if (text.startsWith('CREATE EXTENSION')) throw { code: '42501' }
    return []
  }) as unknown as Sql['unsafe']
  sql.begin = vi.fn(async (callback) => (callback as (tx: Sql) => unknown)(sql)) as Sql['begin']
  return { sql, recorded }
}

describe('runScriptMigrations', () => {
  it('leaves a deferred migration unrecorded without failing the upgrade', async () => {
    const { sql, recorded } = createSqlHarness()
    await expect(runScriptMigrations(sql)).resolves.toBeUndefined()
    expect(recorded).toEqual([])
  })
})
