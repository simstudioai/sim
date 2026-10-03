import { describe, expect, it } from 'vitest'
import {
  resolveFilterSelectValues,
  resolvePredicateSelectValues,
  selectValueToNames,
} from '@/lib/table/select-values'
import type { ColumnDefinition } from '@/lib/table/types'

const status: ColumnDefinition = {
  id: 'col_status',
  name: 'status',
  type: 'select',
  options: [
    { id: 'opt_open', name: 'Open' },
    { id: 'opt_closed', name: 'Closed' },
  ],
}

const tags: ColumnDefinition = {
  id: 'col_tags',
  name: 'tags',
  type: 'select',
  multiple: true,
  options: [
    { id: 'opt_a', name: 'Alpha' },
    { id: 'opt_b', name: 'Beta' },
  ],
}

const title: ColumnDefinition = { id: 'col_title', name: 'title', type: 'string' }

describe('selectValueToNames', () => {
  it('drops orphaned ids in a multi value', () => {
    expect(selectValueToNames(tags, ['opt_a', 'gone'])).toEqual(['Alpha'])
  })
})

// Row-level select resolution now lives in `cell-format.test.ts`,
// fused with the column key translation.

describe('resolveFilterSelectValues', () => {
  const columns = [title, status, tags]

  it('resolves an equality-shorthand option name to its id', () => {
    expect(resolveFilterSelectValues({ col_status: 'Open' }, columns)).toEqual({
      col_status: 'opt_open',
    })
  })

  it('resolves names inside $eq/$ne/$in/$nin operators', () => {
    expect(
      resolveFilterSelectValues(
        { col_status: { $ne: 'Closed' }, col_tags: { $in: ['Alpha', 'Beta'] } },
        columns
      )
    ).toEqual({ col_status: { $ne: 'opt_closed' }, col_tags: { $in: ['opt_a', 'opt_b'] } })
  })

  it('resolves names under $contains/$ncontains (multi-select membership)', () => {
    expect(
      resolveFilterSelectValues(
        { col_tags: { $contains: 'Alpha' }, col_status: { $ncontains: 'Closed' } },
        columns
      )
    ).toEqual({ col_tags: { $contains: 'opt_a' }, col_status: { $ncontains: 'opt_closed' } })
  })

  it('recurses into $and/$or and leaves non-select fields untouched', () => {
    expect(
      resolveFilterSelectValues({ $or: [{ col_status: 'Open' }, { col_title: 'x' }] }, columns)
    ).toEqual({ $or: [{ col_status: 'opt_open' }, { col_title: 'x' }] })
  })
})

/**
 * The block builder serializes without schema access, so an option NAME that
 * looks numeric or boolean arrives scalar-coerced ("123" → 123). Resolution
 * must still find the option, or a correctly-authored builder filter compares
 * a number against the stored id string and matches nothing.
 */
describe('resolvePredicateSelectValues — scalar-coerced option names', () => {
  const numericStatus: ColumnDefinition = {
    id: 'col_code',
    name: 'code',
    type: 'select',
    options: [
      { id: 'opt_123', name: '123' },
      { id: 'opt_true', name: 'true' },
    ],
  }
  const columns = [numericStatus]

  it('resolves a coerced numeric name to its option id', () => {
    expect(
      resolvePredicateSelectValues({ all: [{ field: 'col_code', op: 'eq', value: 123 }] }, columns)
    ).toEqual({ all: [{ field: 'col_code', op: 'eq', value: 'opt_123' }] })
  })

  it('resolves a coerced boolean name, including inside in/contains', () => {
    expect(
      resolvePredicateSelectValues(
        { any: [{ field: 'col_code', op: 'in', value: [true, 123] }] },
        columns
      )
    ).toEqual({ any: [{ field: 'col_code', op: 'in', value: ['opt_true', 'opt_123'] }] })
    expect(
      resolvePredicateSelectValues(
        { all: [{ field: 'col_code', op: 'contains', value: 123 }] },
        columns
      )
    ).toEqual({ all: [{ field: 'col_code', op: 'contains', value: 'opt_123' }] })
  })
})

/**
 * Select-column operand resolution. A select cell stores option IDs, so a filter
 * written with the option NAME must be rewritten before it reaches SQL —
 * otherwise it compares a name against an id and matches nothing while reporting
 * success. Both wire grammars have to do this identically.
 */
describe('resolvePredicateSelectValues', () => {
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
