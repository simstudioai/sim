/**
 * Select-column operand resolution. A select cell stores option IDs, so a filter
 * written with the option NAME must be rewritten before it reaches SQL —
 * otherwise it compares a name against an id and matches nothing while reporting
 * success. Both wire grammars have to do this identically.
 */
import { describe, expect, it } from 'vitest'
import { resolvePredicateSelectValues } from '@/lib/table/select-values'
import type { ColumnDefinition } from '@/lib/table/types'

const MULTI: ColumnDefinition = {
  id: 'col_color',
  name: 'Color',
  type: 'select',
  multiple: true,
  options: [
    { id: 'opt_teal', name: 'Teal' },
    { id: 'opt_green', name: 'Green' },
  ],
}
const SINGLE: ColumnDefinition = {
  id: 'col_status',
  name: 'Status',
  type: 'select',
  options: [{ id: 'opt_open', name: 'Open' }],
}
const PLAIN: ColumnDefinition = { id: 'col_name', name: 'name', type: 'string' }
const COLS = [MULTI, SINGLE, PLAIN]

const leaf = (p: unknown) => (p as { all: Array<{ value: unknown }> }).all[0]

describe('resolvePredicateSelectValues', () => {
  /**
   * Regression: `contains`/`ncontains` were excluded as "pattern ops". On a
   * multi-select they are not pattern ops — the cell is an array of ids and they
   * express membership. Mothership sent exactly this and silently got zero rows.
   */
  it('resolves contains / ncontains on a MULTI-select (membership, not pattern)', () => {
    for (const op of ['contains', 'ncontains'] as const) {
      const out = resolvePredicateSelectValues(
        { all: [{ field: 'col_color', op, value: 'Teal' }] },
        COLS
      )
      expect(leaf(out).value).toBe('opt_teal')
    }
  })

  it('resolves eq / ne / in / nin on a single select', () => {
    expect(
      leaf(
        resolvePredicateSelectValues(
          { all: [{ field: 'col_status', op: 'eq', value: 'Open' }] },
          COLS
        )
      ).value
    ).toBe('opt_open')
    expect(
      leaf(
        resolvePredicateSelectValues(
          { all: [{ field: 'col_status', op: 'in', value: ['Open'] }] },
          COLS
        )
      ).value
    ).toEqual(['opt_open'])
  })

  it('matches option names case-insensitively and passes ids through', () => {
    expect(
      leaf(
        resolvePredicateSelectValues(
          { all: [{ field: 'col_color', op: 'contains', value: 'teal' }] },
          COLS
        )
      ).value
    ).toBe('opt_teal')
    expect(
      leaf(
        resolvePredicateSelectValues(
          { all: [{ field: 'col_color', op: 'contains', value: 'opt_teal' }] },
          COLS
        )
      ).value
    ).toBe('opt_teal')
  })

  it('leaves non-select columns and unknown option names alone', () => {
    expect(
      leaf(
        resolvePredicateSelectValues(
          { all: [{ field: 'col_name', op: 'contains', value: 'Teal' }] },
          COLS
        )
      ).value
    ).toBe('Teal')
    expect(
      leaf(
        resolvePredicateSelectValues(
          { all: [{ field: 'col_color', op: 'contains', value: 'Nope' }] },
          COLS
        )
      ).value
    ).toBe('Nope')
  })
})
