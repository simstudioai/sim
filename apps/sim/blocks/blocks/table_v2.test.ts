/**
 * @vitest-environment node
 *
 * Param-transformer behavior for the v2 Table block: filter/order resolution
 * across builder vs editor modes, the required query limit, cursor artifact
 * handling, and fail-fast limit parsing.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => ({
  getTrigger: vi.fn(() => ({ subBlocks: [] })),
}))

import { TableV2Block } from '@/blocks/blocks/table_v2'

function params(input: Record<string, unknown>): Record<string, unknown> {
  return TableV2Block.tools.config?.params?.(input as never) as Record<string, unknown>
}

describe('table_v2 query_rows transformer', () => {
  it('keeps limit optional (byte-budget page) but fails fast on a non-numeric one', () => {
    const out = params({ operation: 'query_rows', tableId: 't' })
    expect(out.limit).toBeUndefined()
    expect(() => params({ operation: 'query_rows', tableId: 't', limit: 'abc' })).toThrow(
      /Invalid Limit/
    )
  })

  it('treats interpolated "null"/"undefined" cursor artifacts as absent', () => {
    const out = params({ operation: 'query_rows', tableId: 't', limit: '10', cursor: 'null' })
    expect(out.cursor).toBeUndefined()
    const out2 = params({
      operation: 'query_rows',
      tableId: 't',
      limit: '10',
      cursor: 'undefined',
    })
    expect(out2.cursor).toBeUndefined()
    const out3 = params({ operation: 'query_rows', tableId: 't', limit: '10', cursor: 'tok' })
    expect(out3.cursor).toBe('tok')
  })

  it('serializes builder rules to PostgREST when the builder holds rules', () => {
    const out = params({
      operation: 'query_rows',
      tableId: 't',
      limit: '10',
      filterMode: 'builder',
      filterBuilder: [
        { id: '1', logicalOperator: 'and', column: 'wins', operator: 'gte', value: '10' },
      ],
      sortBuilder: [{ id: '1', column: 'wins', direction: 'desc' }],
      filter: 'name=eq.ignored',
    })
    expect(out.filter).toBe('wins=gte.10')
    expect(out.order).toBe('wins.desc')
  })

  it('falls back to the raw PostgREST string when the builder value is not a non-empty array', () => {
    const out = params({
      operation: 'query_rows',
      tableId: 't',
      limit: '10',
      filterMode: 'builder',
      filterBuilder: {},
      filter: 'name=eq.test',
    })
    expect(out.filter).toBe('name=eq.test')
  })
})

describe('table_v2 bulk transformers', () => {
  it('fails fast on a non-numeric bulk limit instead of widening to every match', () => {
    expect(() =>
      params({
        operation: 'delete_rows_by_filter',
        tableId: 't',
        filterMode: 'editor',
        filter: 'name=eq.x',
        limit: 'abc',
      })
    ).toThrow(/Invalid Limit/)
  })

  it('keeps the bulk limit optional', () => {
    const out = params({
      operation: 'delete_rows_by_filter',
      tableId: 't',
      filterMode: 'editor',
      filter: 'name=eq.x',
    })
    expect(out.limit).toBeUndefined()
    expect(out.filter).toBe('name=eq.x')
  })
})
