/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { source } = vi.hoisted(() => ({
  source: {
    rows: [] as Array<{ id: string; data: Record<string, unknown> }>,
    /** Every LIMIT the drain asked for, in order. */
    asks: [] as number[],
  },
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
        source.asks.push(n)
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

  it('sizes later batches by the rows as stored, not by the few projected bytes', async () => {
    // 60 rows of ~200KB: the first batch is capped at 50, so the drain must size a second one.
    const wide = Array.from({ length: 60 }, (_, index) => ({
      id: `row_${index}`,
      data: { col_big: 'x'.repeat(200 * 1024), col_small: `v${index}` },
    }))
    const previous = source.rows
    source.rows = wide
    source.asks = []
    try {
      const result = await drain({ columnIds: new Set(['col_small']) })

      expect(result.rows).toHaveLength(60)
      // A second batch sized from projected bytes would ask for thousands of full rows;
      // bounded by stored bytes it asks for about a budget's worth (5MB / 200KB ≈ 26) + 1.
      expect(source.asks.length).toBeGreaterThan(1)
      expect(Math.max(...source.asks.slice(1))).toBeLessThanOrEqual(27)
    } finally {
      source.rows = previous
    }
  })

  it('lets the widest stored row seen so far bound the next batch, not just the average', async () => {
    // 49 tiny rows and one ~400KB row in the first batch: the stored AVERAGE is ~8KB
    // (a cap of ~640 rows), but a batch of rows as wide as the widest seen must stay
    // within ~8x the budget (5MB * 8 / ~400KB = 103, plus the +1 witness row).
    const mixed = Array.from({ length: 120 }, (_, index) => ({
      id: `row_${index}`,
      data: { col_big: index === 10 ? 'x'.repeat(400 * 1024) : 'x', col_small: `v${index}` },
    }))
    const previous = source.rows
    source.rows = mixed
    source.asks = []
    try {
      const result = await drain({ columnIds: new Set(['col_small']) })

      expect(result.rows).toHaveLength(120)
      expect(source.asks.length).toBeGreaterThan(1)
      expect(Math.max(...source.asks.slice(1))).toBeLessThanOrEqual(104)
    } finally {
      source.rows = previous
    }
  })
})
