/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { source } = vi.hoisted(() => ({
  source: { rows: [] as Array<{ id: string; data: Record<string, unknown> }> },
}))

/**
 * A read guard whose executor serves `source.rows` by LIMIT/OFFSET, which is
 * exactly how the drain advances when keyset re-anchoring is off.
 */
vi.mock('@/lib/table/planner', () => {
  const executor = () => {
    const state = { limit: Number.POSITIVE_INFINITY, offset: 0 }
    const chain = {
      select: () => chain,
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (n: number) => {
        state.limit = n
        return chain
      },
      offset: (n: number) => {
        state.offset = n
        return chain
      },
      then: (resolve: (rows: unknown[]) => void) =>
        resolve(source.rows.slice(state.offset, state.offset + state.limit)),
    }
    return chain
  }
  return {
    withReadGuards: (fn: (trx: unknown) => Promise<unknown>) => fn(executor()),
    withSeqscanOff: (fn: (trx: unknown) => Promise<unknown>) => fn(executor()),
  }
})

import { fetchRowsBounded } from '@/lib/table/rows/service'

const MB = 1024 * 1024
const BUDGET = 5 * MB

function drain(options: { limit?: number; columnIds?: ReadonlySet<string> }) {
  return fetchRowsBounded({
    baseWhere: undefined,
    orderBy: {} as never,
    sorted: false,
    keysetValid: false,
    startOffset: 0,
    budgetBytes: BUDGET,
    pageCutBytes: BUDGET,
    ...options,
  })
}

describe('fetchRowsBounded column projection', () => {
  // Three rows whose full data totals ~9MB but whose `col_small` values total a few bytes.
  source.rows = ['row_1', 'row_2', 'row_3'].map((id) => ({
    id,
    data: { col_big: 'x'.repeat(3 * MB), col_small: id },
  }))

  it('still fails an unbounded query that exceeds the budget on its full rows', async () => {
    await expect(drain({})).rejects.toMatchObject({ code: 'TABLE_QUERY_RESULT_TOO_LARGE' })
  })

  it('measures the projected payload, so a narrow selection fits the same budget', async () => {
    const result = await drain({ columnIds: new Set(['col_small']) })

    expect(result.rows.map((row) => row.data)).toEqual([
      { col_small: 'row_1' },
      { col_small: 'row_2' },
      { col_small: 'row_3' },
    ])
    expect(result.hasMore).toBe(false)
    expect(result.bytes).toBeLessThan(1024)
  })

  it('no longer cuts a bounded page on bytes the response does not carry', async () => {
    const full = await drain({ limit: 10 })
    const narrow = await drain({ limit: 10, columnIds: new Set(['col_small']) })

    expect(full.rows).toHaveLength(1)
    expect(full.hasMore).toBe(true)
    expect(narrow.rows).toHaveLength(3)
    expect(narrow.hasMore).toBe(false)
  })

  it('omits a selected column a row never wrote rather than inventing a key', async () => {
    const result = await drain({ columnIds: new Set(['col_small', 'col_missing']) })

    expect(result.rows[0].data).toEqual({ col_small: 'row_1' })
  })
})
