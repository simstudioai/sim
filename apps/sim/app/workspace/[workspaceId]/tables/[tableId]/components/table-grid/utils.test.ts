/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_TABLE_SELECTION_COLUMNS,
  MAX_TABLE_SELECTION_ROWS,
} from '@/lib/mothership/chat/selection-context'
import { TABLE_LIMITS } from '@/lib/table/constants'
import type { DisplayColumn } from './types'
import {
  buildTableSelectionContext,
  canWriteRowsWithChip,
  chipRowCount,
  drainTargetForChip,
  horizontalEdgeScrollVelocity,
  selectedColumnIds,
} from './utils'

function columns(count: number): DisplayColumn[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    name: `Col ${i}`,
  })) as unknown as DisplayColumn[]
}

const rowIds = (count: number) => Array.from({ length: count }, (_, i) => `r${i}`)

describe('horizontalEdgeScrollVelocity', () => {
  const getVelocity = (pointerX: number) =>
    horizontalEdgeScrollVelocity({
      pointerX,
      visibleLeft: 140,
      visibleRight: 900,
      hotZone: 48,
      maxVelocity: 14,
    })

  it('scrolls left when the pointer enters the visible edge after sticky columns', () => {
    expect(getVelocity(140)).toBe(-14)
    expect(getVelocity(164)).toBe(-7)
  })

  it('scrolls right at the opposite edge and stays still between edge zones', () => {
    expect(getVelocity(876)).toBe(7)
    expect(getVelocity(900)).toBe(14)
    expect(getVelocity(500)).toBe(0)
  })

  it('stays still when pinned columns consume the visible viewport', () => {
    expect(
      horizontalEdgeScrollVelocity({
        pointerX: 100,
        visibleLeft: 200,
        visibleRight: 100,
        hotZone: 48,
        maxVelocity: 14,
      })
    ).toBe(0)
  })

  it('uses the nearest edge when a narrow viewport would overlap both hot zones', () => {
    const narrowVelocity = (pointerX: number) =>
      horizontalEdgeScrollVelocity({
        pointerX,
        visibleLeft: 100,
        visibleRight: 140,
        hotZone: 48,
        maxVelocity: 14,
      })

    expect(narrowVelocity(105)).toBe(-11)
    expect(narrowVelocity(120)).toBe(0)
    expect(narrowVelocity(135)).toBe(11)
  })
})

describe('selectedColumnIds', () => {
  it('returns the ids the range spans', () => {
    expect(selectedColumnIds(columns(5), { startCol: 1, endCol: 3 })).toEqual(['c1', 'c2', 'c3'])
  })

  it('stops at the last column when the range overruns', () => {
    expect(selectedColumnIds(columns(2), { startCol: 0, endCol: 9 })).toEqual(['c0', 'c1'])
  })
})

describe('buildTableSelectionContext', () => {
  const base = { tableId: 't1', tableName: 'Sales' }

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

  it('leaves the scope open only when no columns are given (whole rows)', () => {
    const context = buildTableSelectionContext({ ...base, rowIds: ['r1'] })

    if (context?.kind !== 'table_selection') throw new Error('expected a table_selection')
    expect(context.columnIds).toBeUndefined()
  })

  it('keeps a narrower range scoped, capped at the column limit', () => {
    const context = buildTableSelectionContext({
      ...base,
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

describe('chipRowCount', () => {
  it.each([1, 42, MAX_TABLE_SELECTION_ROWS, MAX_TABLE_SELECTION_ROWS + 250, 50_000])(
    'agrees with what a context carries for %i requested rows',
    (requested) => {
      // The invariant that keeps breaking: a label derived from the raw
      // selection size over-promises once the context caps its rowIds, and one
      // derived from the loaded page under-promises. Both must equal this.
      const context = buildTableSelectionContext({
        tableId: 't1',
        tableName: 'Sales',
        rowIds: rowIds(requested),
      })

      if (context?.kind !== 'table_selection') throw new Error('expected a table_selection')
      expect(chipRowCount(requested)).toBe(context.rowIds.length)
    }
  )
})

describe('drainTargetForChip', () => {
  it('still yields a full cap when every exclusion lands in the loaded prefix', () => {
    // The worst case for a gutter select-all: exclusions are filtered out AFTER
    // loading, so loading only the cap would leave the chip short of the count
    // the menu already advertised.
    const excluded = 30

    expect(drainTargetForChip(excluded) - excluded).toBe(MAX_TABLE_SELECTION_ROWS)
  })

  it('loads exactly the cap when nothing is excluded', () => {
    expect(drainTargetForChip(0)).toBe(MAX_TABLE_SELECTION_ROWS)
  })
})
