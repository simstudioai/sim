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

  it('compiles builder rules (basic canonical value) to a predicate + sort spec', () => {
    const out = params({
      operation: 'query_rows',
      tableId: 't',
      limit: '10',
      // filterInput/sortInput carry the ACTIVE canonical mode's value; the visual
      // builders (basic) emit rule arrays.
      filterInput: [
        { id: '1', logicalOperator: 'and', column: 'wins', operator: 'gte', value: '10' },
      ],
      sortInput: [{ id: '1', column: 'wins', direction: 'desc' }],
    })
    expect(out.filter).toEqual({ all: [{ field: 'wins', op: 'gte', value: 10 }] })
    expect(out.order).toEqual([{ field: 'wins', direction: 'desc' }])
  })

  it('parses the editor JSON string (advanced canonical value) into a predicate', () => {
    const out = params({
      operation: 'query_rows',
      tableId: 't',
      limit: '10',
      filterInput: '{"all":[{"field":"name","op":"eq","value":"test"}]}',
    })
    expect(out.filter).toEqual({ all: [{ field: 'name', op: 'eq', value: 'test' }] })
  })
})

describe('table_v2 bulk transformers', () => {
  const editorFilter = '{"all":[{"field":"name","op":"eq","value":"x"}]}'

  it('fails fast on a non-numeric bulk limit instead of widening to every match', () => {
    expect(() =>
      params({
        operation: 'delete_rows_by_filter',
        tableId: 't',
        filterInput: editorFilter,
        limit: 'abc',
      })
    ).toThrow(/Invalid Limit/)
  })

  it('keeps the bulk limit optional', () => {
    const out = params({
      operation: 'delete_rows_by_filter',
      tableId: 't',
      filterInput: editorFilter,
    })
    expect(out.limit).toBeUndefined()
    expect(out.filter).toEqual({ all: [{ field: 'name', op: 'eq', value: 'x' }] })
  })
})

/**
 * The Filter/Order fields are canonical pairs: a builder array in Builder mode,
 * a JSON string in Editor mode. Clearing the editor field is the ordinary way to
 * say "no filter" — it must not surface as a JSON parse error at run time.
 */
describe('table_v2 blank and malformed editor inputs', () => {
  const base = { operation: 'query_rows', tableId: 'tbl_1', limit: '10' }

  it('treats a blank / whitespace filter or order as absent', () => {
    for (const value of ['', '   ', '\n']) {
      expect(params({ ...base, filterInput: value }).filter).toBeUndefined()
      expect(params({ ...base, sortInput: value }).order).toBeUndefined()
    }
  })

  it('treats an empty builder array as absent', () => {
    expect(params({ ...base, filterInput: [] }).filter).toBeUndefined()
    expect(params({ ...base, sortInput: [] }).order).toBeUndefined()
  })

  it('still reports genuinely malformed JSON', () => {
    expect(() => params({ ...base, filterInput: '{not json}' })).toThrow(/Invalid JSON in Filter/)
    expect(() => params({ ...base, sortInput: '{not json}' })).toThrow(/Invalid JSON in Sort/)
  })
})
