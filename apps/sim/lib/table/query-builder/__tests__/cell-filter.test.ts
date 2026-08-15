/**
 * @vitest-environment node
 *
 * "Filter by cell value" unit tests. The property that matters throughout: the
 * row the user right-clicked must survive the filter its own cell produced.
 */
import { describe, expect, it } from 'vitest'
import {
  cellValueFilterConditions,
  withCellValueFilter,
} from '@/lib/table/query-builder/cell-filter'
import type { ColumnDefinition, TablePredicate } from '@/lib/table/types'

function column(overrides: Partial<ColumnDefinition> = {}): ColumnDefinition {
  return { id: 'col_a', name: 'Name', type: 'string', ...overrides } as ColumnDefinition
}

describe('cellValueFilterConditions', () => {
  it('offers nothing without a column', () => {
    expect(cellValueFilterConditions(undefined, 'x')).toEqual([])
  })

  it('keys conditions on the column id, not its display name', () => {
    expect(cellValueFilterConditions(column({ id: 'col_a', name: 'Name' }), 'Ada')).toEqual([
      { field: 'col_a', op: 'eq', value: 'Ada' },
    ])
  })

  it('falls back to the name when the column carries no id', () => {
    const legacy = { name: 'Name', type: 'string' } as ColumnDefinition
    expect(cellValueFilterConditions(legacy, 'Ada')).toEqual([
      { field: 'Name', op: 'eq', value: 'Ada' },
    ])
  })

  it('carries scalars through untouched rather than via text', () => {
    expect(cellValueFilterConditions(column({ type: 'number' }), 8)).toEqual([
      { field: 'col_a', op: 'eq', value: 8 },
    ])
    expect(cellValueFilterConditions(column({ type: 'boolean' }), false)).toEqual([
      { field: 'col_a', op: 'eq', value: false },
    ])
    // A numeric-looking string cell stays a string — text round-tripping would
    // coerce it to 8 and stop matching the stored value.
    expect(cellValueFilterConditions(column(), '8')).toEqual([
      { field: 'col_a', op: 'eq', value: '8' },
    ])
  })

  it('keeps a date cell byte-exact', () => {
    const stored = '2024-01-31T10:00:00.000Z'
    expect(cellValueFilterConditions(column({ type: 'date' }), stored)).toEqual([
      { field: 'col_a', op: 'eq', value: stored },
    ])
  })

  it.each([[null], [undefined], ['']])('maps %p onto isEmpty', (value) => {
    expect(cellValueFilterConditions(column(), value)).toEqual([{ field: 'col_a', op: 'isEmpty' }])
  })

  it('compares a single-select by option id', () => {
    const col = column({ type: 'select', options: [{ id: 'opt_a', name: 'Alpha' }] })
    expect(cellValueFilterConditions(col, 'opt_a')).toEqual([
      { field: 'col_a', op: 'eq', value: 'opt_a' },
    ])
  })

  it('asks a multi-select about membership, one condition per option', () => {
    const col = column({
      type: 'select',
      multiple: true,
      options: [
        { id: 'opt_a', name: 'Alpha' },
        { id: 'opt_b', name: 'Beta' },
      ],
    })
    expect(cellValueFilterConditions(col, ['opt_a', 'opt_b'])).toEqual([
      { field: 'col_a', op: 'contains', value: 'opt_a' },
      { field: 'col_a', op: 'contains', value: 'opt_b' },
    ])
  })

  it('treats an empty multi-select cell as empty', () => {
    const col = column({ type: 'select', multiple: true, options: [{ id: 'opt_a', name: 'A' }] })
    expect(cellValueFilterConditions(col, [])).toEqual([{ field: 'col_a', op: 'isEmpty' }])
  })

  it('refuses an operator the column type rejects', () => {
    // A multi-select accepts contains/ncontains/empty only — `eq` against the
    // array cell can never be true, so a scalar reading has no filter to offer.
    const multi = column({ type: 'select', multiple: true, options: [{ id: 'opt_a', name: 'A' }] })
    expect(cellValueFilterConditions(multi, 'opt_a')).toEqual([])
  })

  it('refuses a structured value with no meaningful equality', () => {
    expect(cellValueFilterConditions(column({ type: 'json' }), { a: 1 })).toEqual([])
    expect(cellValueFilterConditions(column({ type: 'json' }), [1, 2])).toEqual([])
  })

  // A json cell holding a STRING array is shaped exactly like a multi-select
  // cell. The server accepts `contains` on json and compiles it to an ILIKE
  // substring match, so letting it through would quietly match unrelated rows.
  it('refuses a json cell holding a string array', () => {
    expect(cellValueFilterConditions(column({ type: 'json' }), ['a', 'b'])).toEqual([])
  })

  // `json.coerce` accepts anything, so a json cell legitimately holds a scalar.
  // The server rejects eq/ne/in/nin on a json column, and the rejected filter
  // would stick in state and 400 every later refetch.
  it.each([['hello'], [42], [true]])('refuses eq on a json cell holding %p', (value) => {
    expect(cellValueFilterConditions(column({ type: 'json' }), value)).toEqual([])
  })

  it('still offers isEmpty on an empty json cell', () => {
    expect(cellValueFilterConditions(column({ type: 'json' }), null)).toEqual([
      { field: 'col_a', op: 'isEmpty' },
    ])
  })
})

describe('withCellValueFilter', () => {
  const eqA = { field: 'col_a', op: 'eq', value: 'x' } as const

  it('starts a new filter when none is active', () => {
    expect(withCellValueFilter(null, [eqA])).toEqual({ all: [eqA] })
  })

  it('keeps conditions on other columns', () => {
    const current: TablePredicate = { all: [{ field: 'col_b', op: 'eq', value: 1 }] }
    expect(withCellValueFilter(current, [eqA])).toEqual({
      all: [{ field: 'col_b', op: 'eq', value: 1 }, eqA],
    })
  })

  it('replaces an earlier condition on the same column instead of AND-ing it', () => {
    const current: TablePredicate = { all: [{ field: 'col_a', op: 'eq', value: 'old' }] }
    expect(withCellValueFilter(current, [eqA])).toEqual({ all: [eqA] })
  })

  it('keeps an any-group that does not touch the column', () => {
    const current: TablePredicate = {
      any: [{ all: [{ field: 'col_b', op: 'eq', value: 'x' }] }],
    }
    expect(withCellValueFilter(current, [eqA])).toEqual({ all: [current, eqA] })
  })

  // Reachable from the panel: an `or` rule produces an `any` group, and a cell
  // filter on a column inside it would otherwise AND against the disjunction
  // and empty the table.
  it('drops a nested group that constrains the same column', () => {
    const current: TablePredicate = {
      any: [
        { all: [{ field: 'col_a', op: 'eq', value: 'old' }] },
        { all: [{ field: 'col_b', op: 'eq', value: 'keep' }] },
      ],
    }
    expect(withCellValueFilter(current, [eqA])).toEqual({ all: [eqA] })
  })

  it('drops a same-column leaf nested inside an all-group', () => {
    const current: TablePredicate = {
      all: [
        { all: [{ field: 'col_a', op: 'eq', value: 'old' }] },
        { field: 'col_b', op: 'eq', value: 'keep' },
      ],
    }
    expect(withCellValueFilter(current, [eqA])).toEqual({
      all: [{ field: 'col_b', op: 'eq', value: 'keep' }, eqA],
    })
  })

  // An `{ all: [] }` group is not a valid predicate — the server rejects it.
  it('leaves the filter untouched when there are no conditions', () => {
    const current: TablePredicate = { all: [{ field: 'col_a', op: 'eq', value: 'x' }] }
    expect(withCellValueFilter(current, [])).toBe(current)
    expect(withCellValueFilter(null, [])).toBeNull()
  })
})
