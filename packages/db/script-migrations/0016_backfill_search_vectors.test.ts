import {
  backfillSearchVectorsMigration,
  runDevSearchBackfill,
} from '@sim/db/script-migrations/0016_backfill_search_vectors'
import type { Sql } from 'postgres'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Models the ledger while keeping the expensive projection work mocked. */
function createLedger(appliedNames: string[] = []) {
  const names = new Set(appliedNames)
  const query = vi.fn(async (parts: TemplateStringsArray, name?: string) => {
    const statement = parts.join('?').trim()
    if (statement.startsWith('SELECT name')) {
      return name && names.has(name) ? [{ name }] : []
    }
    if (statement.startsWith('INSERT INTO script_migrations') && name) names.add(name)
    return []
  })
  const begin = vi.fn(async (callback: (tx: typeof query) => Promise<void>) => callback(query))
  return { names, begin, sql: Object.assign(query, { begin }) as unknown as Sql }
}

afterEach(() => vi.restoreAllMocks())

describe('dev search backfill tracking', () => {
  it('records success and skips projection work on the next deploy', async () => {
    const up = vi.spyOn(backfillSearchVectorsMigration, 'up').mockResolvedValue(undefined)
    const { sql, names } = createLedger()
    await runDevSearchBackfill(sql)
    expect(names).toEqual(
      new Set(['0015_backfill_embedding_search', '0016_backfill_search_vectors'])
    )
    await runDevSearchBackfill(sql)
    expect(up).toHaveBeenCalledTimes(1)
  })

  it('retries failed work without recording completion', async () => {
    const up = vi
      .spyOn(backfillSearchVectorsMigration, 'up')
      .mockRejectedValueOnce(new Error('backfill interrupted'))
      .mockResolvedValue(undefined)
    const { sql, names, begin } = createLedger()
    await expect(runDevSearchBackfill(sql)).rejects.toThrow('backfill interrupted')
    expect(names.size).toBe(0)
    expect(begin).not.toHaveBeenCalled()
    await runDevSearchBackfill(sql)
    expect(names.has(backfillSearchVectorsMigration.name)).toBe(true)
    expect(up).toHaveBeenCalledTimes(2)
  })

  it('runs the vector upgrade even when the older binary backfill is recorded', async () => {
    const up = vi.spyOn(backfillSearchVectorsMigration, 'up').mockResolvedValue(undefined)
    const { sql } = createLedger(['0015_backfill_embedding_search'])
    await runDevSearchBackfill(sql)
    expect(up).toHaveBeenCalledOnce()
  })

  it('skips a backfill already recorded by the tracked migration runner', async () => {
    const up = vi.spyOn(backfillSearchVectorsMigration, 'up').mockResolvedValue(undefined)
    const { sql, begin } = createLedger([backfillSearchVectorsMigration.name])
    await runDevSearchBackfill(sql)
    expect(up).not.toHaveBeenCalled()
    expect(begin).not.toHaveBeenCalled()
  })
})
