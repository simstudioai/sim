import { triggersMock } from '@sim/testing/mocks/triggers.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => triggersMock)

import { TableBlock } from '@/blocks/blocks/table'

function params(
  input: Record<string, unknown>,
  context?: { operation: string }
): Record<string, unknown> {
  return TableBlock.tools.config?.params?.(input as never, context) as Record<string, unknown>
}

describe('table query_rows transformer', () => {
  it('keeps an omitted limit unbounded', () => {
    expect(params({ operation: 'query_rows', tableId: 'table-1' }).limit).toBeUndefined()
  })

  it('parses and validates an explicit limit', () => {
    expect(params({ operation: 'query_rows', tableId: 'table-1', limit: '25' }).limit).toBe(25)
    expect(params({ operation: 'query_rows', tableId: 'table-1', limit: '1000000' }).limit).toBe(
      1000000
    )
    expect(() => params({ operation: 'query_rows', tableId: 'table-1', limit: 'abc' })).toThrow(
      /Invalid number for Limit/
    )
  })

  it('passes selected output columns to the query tool and treats an empty selection as all', () => {
    expect(
      params({ operation: 'query_rows', tableId: 'table-1', outputColumns: ['Email'] }).columns
    ).toEqual(['Email'])
    expect(
      params({ operation: 'query_rows', tableId: 'table-1', outputColumns: [] }).columns
    ).toBeUndefined()
  })
})

describe('table transformers on an Agent tool call (operation only in context)', () => {
  const winsRule = [
    { id: '1', logicalOperator: 'and', column: 'wins', operator: 'gte', value: '10' },
  ]

  it('compiles the tool row builder filter and sort and coerces the limit', () => {
    const out = params(
      {
        tableId: 'table-1',
        builderMode: 'builder',
        filterBuilder: winsRule,
        sortBuilder: [{ id: '1', column: 'wins', direction: 'desc' }],
        limit: 5,
      },
      { operation: 'query_rows' }
    )
    expect(out.filter).toEqual({ wins: { $gte: 10 } })
    expect(out.sort).toEqual({ wins: 'desc' })
    expect(out.limit).toBe(5)
  })

  it('keeps the model filter and sort when the stored builder rule list is empty', () => {
    const out = params(
      {
        tableId: 'table-1',
        builderMode: 'builder',
        filterBuilder: [],
        sortBuilder: [],
        filter: { status: 'active' },
        sort: '{"wins":"desc"}',
      },
      { operation: 'query_rows' }
    )
    expect(out.filter).toEqual({ status: 'active' })
    expect(out.sort).toEqual({ wins: 'desc' })
  })

  it('keeps the model filter for a bulk delete when the stored bulk builder is empty', () => {
    const out = params(
      { tableId: 'table-1', bulkFilterMode: 'builder', bulkFilterBuilder: [], filter: '{"a":1}' },
      { operation: 'delete_rows_by_filter' }
    )
    expect(out.filter).toEqual({ a: 1 })
  })

  it('leaves an empty canvas builder with no filter even when a stale JSON filter is saved', () => {
    const out = params({
      operation: 'query_rows',
      tableId: 'table-1',
      builderMode: 'builder',
      filterBuilder: [],
      filter: '{"stale":true}',
    })
    expect(out.filter).toBeUndefined()
  })
})
