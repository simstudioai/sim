/**
 * @vitest-environment node
 */
import type { Sql } from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import { runScriptMigrations, scriptMigrations } from './index'
import { type ScriptMigration, ScriptMigrationDeferred } from './types'

const TIN = '0019_tin_keyword_projection'

/** Every registered migration but Tin's, so Tin is the only pending one. */
const APPLIED_BEFORE_TIN = scriptMigrations
  .filter(({ name }) => name !== TIN)
  .map(({ name }) => name)

/** A session where `applied` is already recorded and the database refuses `tin`. */
function createSqlHarness(applied: readonly string[]) {
  const recorded: string[] = []
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim()
    if (text.startsWith('SELECT name FROM script_migrations')) {
      return Promise.resolve(applied.map((name) => ({ name })))
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
    const { sql, recorded } = createSqlHarness(APPLIED_BEFORE_TIN)
    await expect(runScriptMigrations(sql)).resolves.toBeUndefined()
    expect(recorded).toEqual([])
  })

  it('applies and records the migrations that follow a deferred one', async () => {
    const deferring: ScriptMigration = {
      name: 'test_deferring',
      up: async () => {
        throw new ScriptMigrationDeferred('the database refused the test migration')
      },
    }
    const following: ScriptMigration = { name: 'test_following', up: async () => {} }
    const { sql, recorded } = createSqlHarness([])
    await expect(runScriptMigrations(sql, [deferring, following])).resolves.toBeUndefined()
    expect(recorded).toEqual(['test_following'])
  })
})
