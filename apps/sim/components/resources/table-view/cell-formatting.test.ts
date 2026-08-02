/**
 * @vitest-environment node
 *
 * Every surface that draws a table resolves its cell text through the
 * column-type registry, so a currency column reads `$1,234.50` and a select
 * column shows its option *name* wherever it is mounted — the tables grid, an
 * embedded panel, or a public share.
 *
 * This pins the registry contract `CellContent` depends on. It regressed once:
 * the interface module carried its own resolver that handled only
 * boolean/null/json/date/string and let currency and select fall through to
 * `JSON.stringify`, so a module rendered `1234.5` and `opt_open` where the grid
 * rendered `$1,234.50` and `Open`.
 */
import { describe, expect, it } from 'vitest'
import { columnTypeOf } from '@/lib/table/column-types'
import type { ColumnDefinition } from '@/lib/table/types'

function column(overrides: Partial<ColumnDefinition> & Pick<ColumnDefinition, 'type'>) {
  return { id: 'col_1', name: 'col', ...overrides } as ColumnDefinition
}

describe('table cell display formatting', () => {
  it('formats currency through the registry, not as a bare number', () => {
    const col = column({ type: 'currency', currencyCode: 'USD' })
    const text = columnTypeOf(col).formatForDisplay(1234.5, col)

    expect(text).not.toBe('1234.5')
    expect(text).toContain('1,234.50')
  })

  it('resolves a select option id to its name', () => {
    const col = column({
      type: 'select',
      options: [
        { id: 'opt_open', name: 'Open' },
        { id: 'opt_done', name: 'Done' },
      ],
    })

    expect(columnTypeOf(col).formatForDisplay('opt_open', col)).toBe('Open')
  })

  it('joins a multi-select rather than emitting raw JSON', () => {
    const col = column({
      type: 'select',
      multiple: true,
      options: [
        { id: 'opt_a', name: 'Alpha' },
        { id: 'opt_b', name: 'Beta' },
      ],
    })
    const text = columnTypeOf(col).formatForDisplay(['opt_a', 'opt_b'], col)

    expect(text).not.toContain('opt_a')
    expect(text).toBe('Alpha, Beta')
  })

  /**
   * The registry's completeness gate means every column type has a formatter;
   * that is what lets the cell layer use one fallback branch instead of a
   * per-type switch that would drift from the grid's.
   */
  it('gives every column type a display formatter', () => {
    for (const type of ['string', 'number', 'boolean', 'date', 'json', 'select', 'currency']) {
      const col = column({ type: type as ColumnDefinition['type'] })
      expect(typeof columnTypeOf(col).formatForDisplay, type).toBe('function')
    }
  })
})
