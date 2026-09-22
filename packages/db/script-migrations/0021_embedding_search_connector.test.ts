/**
 * @vitest-environment node
 */
import {
  backfillProjectionSourceAcl,
  PROJECTION_SOURCE_ACL_PAGE_RETRIES,
} from '@sim/db/script-migrations/0021_embedding_search_connector'
import type { Sql } from 'postgres'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** A session that must never be reached: every case below is refused before the first page. */
const untouched = { begin: vi.fn() } as unknown as Sql

type PageRow = { scanned: number; filled: number; last_id: string | null }

/** A driver error carrying a SQLSTATE, the shape `postgres` throws. */
function postgresError(code: string): Error {
  return Object.assign(new Error(`canceling statement (SQLSTATE ${code})`), { code })
}

/**
 * A session whose page statement answers from `outcomes` in order — a row, or an error to throw —
 * and records the cursor each page was bound to. `beforePage` runs with the page's index before
 * it answers.
 */
function sessionOf(outcomes: Array<PageRow | Error>, beforePage?: (index: number) => void) {
  const cursors: string[] = []
  const tx = {
    unsafe: vi.fn(async (query: string, params?: unknown[]) => {
      if (!query.includes('WITH page')) return []
      beforePage?.(cursors.length)
      cursors.push(String(params?.[0]))
      const outcome = outcomes.shift()
      if (outcome === undefined) throw new Error('No outcome left for this page')
      if (outcome instanceof Error) throw outcome
      return [outcome]
    }),
  }
  const session = {
    begin: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(tx)),
    unsafe: vi.fn(async () => []),
  } as unknown as Sql
  return { session, cursors }
}

/** Runs a backfill under fake timers, so its retry pauses pass without waiting. */
async function backfillNow(...args: Parameters<typeof backfillProjectionSourceAcl>) {
  vi.useFakeTimers()
  const result = backfillProjectionSourceAcl(...args)
  /** A rejection must not surface as unhandled while the timers are still being drained. */
  const settled = result.catch(() => undefined)
  await vi.runAllTimersAsync()
  await settled
  return result
}

describe('backfillProjectionSourceAcl', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['55P03', '57014'])(
    'retries the page after a %s timeout and moves the cursor only once it commits',
    async (code) => {
      const { session, cursors } = sessionOf([
        { scanned: 2, filled: 2, last_id: 'id-2' },
        postgresError(code),
        postgresError(code),
        { scanned: 1, filled: 1, last_id: 'id-3' },
        { scanned: 0, filled: 0, last_id: null },
      ])
      await expect(
        backfillNow(session, 'embedding_keyword_tin', { pauseMs: 0 })
      ).resolves.toMatchObject({ scanned: 3, written: 3, afterId: 'id-3', done: true })
      expect(cursors).toEqual(['', 'id-2', 'id-2', 'id-2', 'id-3'])
    }
  )

  it('gives up on a page that times out more than the retry limit in a row', async () => {
    const { session, cursors } = sessionOf(
      Array.from({ length: PROJECTION_SOURCE_ACL_PAGE_RETRIES + 1 }, () => postgresError('55P03'))
    )
    await expect(backfillNow(session, 'embedding_keyword_tin', { pauseMs: 0 })).rejects.toThrow(
      'SQLSTATE 55P03'
    )
    expect(cursors).toHaveLength(PROJECTION_SOURCE_ACL_PAGE_RETRIES + 1)
    expect(new Set(cursors)).toEqual(new Set(['']))
  })

  it('propagates an error that is not a timeout without retrying', async () => {
    const { session, cursors } = sessionOf([postgresError('42P01')])
    await expect(backfillNow(session, 'embedding_search', { pauseMs: 0 })).rejects.toThrow(
      'SQLSTATE 42P01'
    )
    expect(cursors).toEqual([''])
  })

  it('leaves a page still failing at the budget to the continuation, from the last committed page', async () => {
    const { session, cursors } = sessionOf(
      [{ scanned: 1, filled: 1, last_id: 'id-1' }, postgresError('57014')],
      /** The second page spends the budget before the database cancels it. */
      (index) => {
        if (index === 1) vi.advanceTimersByTime(1000)
      }
    )
    await expect(
      backfillNow(session, 'embedding_search', { pauseMs: 0, budgetMs: 1000 })
    ).resolves.toMatchObject({ afterId: 'id-1', done: false })
    expect(cursors).toEqual(['', 'id-1'])
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a page size of %s instead of reporting the projection filled',
    async (pageSize) => {
      await expect(
        backfillProjectionSourceAcl(untouched, 'embedding_search', { pageSize })
      ).rejects.toThrow('page size must be a positive integer')
      expect(untouched.begin).not.toHaveBeenCalled()
    }
  )

  it.each([-1, Number.NaN])('refuses a pause of %s', async (pauseMs) => {
    await expect(
      backfillProjectionSourceAcl(untouched, 'embedding_search', { pauseMs })
    ).rejects.toThrow('pause must be a non-negative number')
    expect(untouched.begin).not.toHaveBeenCalled()
  })

  it('binds the range it was given to every page, so shards never meet', async () => {
    const statements: Array<{ query: string; params?: unknown[] }> = []
    const tx = {
      unsafe: vi.fn(async (query: string, params?: unknown[]) => {
        statements.push({ query, params })
        return query.includes('WITH page') ? [{ scanned: 0, filled: 0, last_id: null }] : []
      }),
    }
    const session = {
      begin: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(tx)),
      unsafe: vi.fn(async () => []),
    } as unknown as Sql
    await expect(
      backfillProjectionSourceAcl(session, 'embedding_search', { afterId: '4', beforeId: '8' })
    ).resolves.toMatchObject({ done: true })
    const page = statements.find((statement) => statement.query.includes('WITH page'))!
    expect(page.query).toContain('($2::text IS NULL OR s.id < $2)')
    expect(page.params).toEqual(['4', '8'])
  })
})
