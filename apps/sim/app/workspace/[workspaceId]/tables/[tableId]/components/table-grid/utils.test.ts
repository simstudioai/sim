import { describe, expect, it } from 'vitest'
import { MAX_TABLE_SELECTION_ROWS } from '@/lib/mothership/chat/selection-context'
import { buildTableSelectionContext, drainTargetForChip } from './utils'

const rowIds = (count: number) => Array.from({ length: count }, (_, i) => `r${i}`)

describe('buildTableSelectionContext', () => {
  const base = { tableId: 't1', tableName: 'Sales' }

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

  it('keeps a full-width range scoped rather than widening it to every column', () => {
    // Callers can only count rendered columns, which drop hidden ones and expand
    // workflow groups — so "covers everything visible" is not "covers the
    // schema". Widening here would re-fetch columns the user had hidden.
    const context = buildTableSelectionContext({
      ...base,
      rowIds: ['r1'],
      columnIds: ['c0', 'c1', 'c2'],
    })

    if (context?.kind !== 'table_selection') throw new Error('expected a table_selection')
    expect(context.columnIds).toEqual(['c0', 'c1', 'c2'])
  })
})

describe('drainTargetForChip', () => {
  it('still yields a full cap when every exclusion lands in the loaded prefix', () => {
    // The worst case for a gutter select-all: exclusions are filtered out AFTER
    // loading, so loading only the cap would leave the chip short of the count
    // the menu already advertised.
    const excluded = 30

    expect(drainTargetForChip(excluded) - excluded).toBe(MAX_TABLE_SELECTION_ROWS)
  })
})
