/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_TABLE_SELECTION_COLUMNS,
  MAX_TABLE_SELECTION_ROWS,
} from '@/lib/copilot/chat/selection-context'
import { TABLE_LIMITS } from '@/lib/table/constants'
import type { DisplayColumn } from './types'
import { buildTableSelectionContext, canWriteRowsWithChip, selectedColumnIds } from './utils'

function columns(count: number): DisplayColumn[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    name: `Col ${i}`,
  })) as unknown as DisplayColumn[]
}

const rowIds = (count: number) => Array.from({ length: count }, (_, i) => `r${i}`)

describe('selectedColumnIds', () => {
  it('returns the ids the range spans', () => {
    expect(selectedColumnIds(columns(5), { startCol: 1, endCol: 3 })).toEqual(['c1', 'c2', 'c3'])
  })

  it('stops at the last column when the range overruns', () => {
    expect(selectedColumnIds(columns(2), { startCol: 0, endCol: 9 })).toEqual(['c0', 'c1'])
  })
})

describe('buildTableSelectionContext', () => {
  const base = { tableId: 't1', tableName: 'Sales', totalColumnCount: 3 }

  it('returns null before the table name has loaded, or with nothing selected', () => {
    expect(buildTableSelectionContext({ ...base, tableName: undefined, rowIds: ['r1'] })).toBeNull()
    expect(buildTableSelectionContext({ ...base, rowIds: [] })).toBeNull()
  })

  it('caps rows at the chip limit and labels the capped count, not the requested one', () => {
    const context = buildTableSelectionContext({
      ...base,
      rowIds: rowIds(MAX_TABLE_SELECTION_ROWS + 250),
    })

    expect(context?.kind).toBe('table_selection')
    if (context?.kind !== 'table_selection') throw new Error('expected a table_selection')
    expect(context.rowIds).toHaveLength(MAX_TABLE_SELECTION_ROWS)
    expect(context.label).toContain(`${MAX_TABLE_SELECTION_ROWS} rows`)
  })

  it('collapses a range covering every column to an open scope', () => {
    // Equivalent to whole rows — leaving it open keeps the server correct if the
    // schema changes, instead of pinning a now-stale column list.
    const context = buildTableSelectionContext({
      ...base,
      rowIds: ['r1'],
      columnIds: ['c0', 'c1', 'c2'],
    })

    if (context?.kind !== 'table_selection') throw new Error('expected a table_selection')
    expect(context.columnIds).toBeUndefined()
  })

  it('keeps a narrower range scoped, capped at the column limit', () => {
    const context = buildTableSelectionContext({
      ...base,
      totalColumnCount: MAX_TABLE_SELECTION_COLUMNS + 50,
      rowIds: ['r1'],
      columnIds: Array.from({ length: MAX_TABLE_SELECTION_COLUMNS + 10 }, (_, i) => `c${i}`),
    })

    if (context?.kind !== 'table_selection') throw new Error('expected a table_selection')
    expect(context.columnIds).toHaveLength(MAX_TABLE_SELECTION_COLUMNS)
  })
})

describe('canWriteRowsWithChip', () => {
  const ok = { rowCount: 10, complete: true, hasContext: true }

  it('allows a complete, in-bounds selection that has a chip to carry', () => {
    expect(canWriteRowsWithChip(ok)).toBe(true)
  })

  it('defers when there is no chip, nothing selected, or the paged path would load more', () => {
    expect(canWriteRowsWithChip({ ...ok, hasContext: false })).toBe(false)
    expect(canWriteRowsWithChip({ ...ok, rowCount: 0 })).toBe(false)
    expect(canWriteRowsWithChip({ ...ok, complete: false })).toBe(false)
  })

  it('stays allowed past the chip row cap — the context caps itself', () => {
    // Gating on MAX_TABLE_SELECTION_ROWS here would drop the chip entirely on
    // the async fall-through, while Add to Chat on the same selection still
    // produces a capped chip.
    expect(canWriteRowsWithChip({ ...ok, rowCount: MAX_TABLE_SELECTION_ROWS + 100 })).toBe(true)
  })

  it('defers past the text copy limit, which owns truncation', () => {
    expect(canWriteRowsWithChip({ ...ok, rowCount: TABLE_LIMITS.MAX_COPY_ROWS })).toBe(true)
    expect(canWriteRowsWithChip({ ...ok, rowCount: TABLE_LIMITS.MAX_COPY_ROWS + 1 })).toBe(false)
  })
})
