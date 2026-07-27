/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  fillMissingColumns,
  formatCellValue,
  mapInputValues,
  namedRowMapper,
} from '@/lib/table/cell-format'
import type { ColumnDefinition } from '@/lib/table/types'

const status: ColumnDefinition = {
  id: 'col_status',
  name: 'Status',
  type: 'select',
  options: [
    { id: 'opt_open', name: 'Open' },
    { id: 'opt_closed', name: 'Closed' },
  ],
}

const tags: ColumnDefinition = {
  id: 'col_tags',
  name: 'Tags',
  type: 'select',
  multiple: true,
  options: [
    { id: 'opt_a', name: 'Alpha' },
    { id: 'opt_b', name: 'Beta' },
  ],
}

const title: ColumnDefinition = { id: 'col_title', name: 'Title', type: 'string' }
const count: ColumnDefinition = { id: 'col_count', name: 'Count', type: 'number' }
const done: ColumnDefinition = { id: 'col_done', name: 'Done', type: 'boolean' }
const due: ColumnDefinition = { id: 'col_due', name: 'Due', type: 'date' }
const meta: ColumnDefinition = { id: 'col_meta', name: 'Meta', type: 'json' }

describe('formatCellValue — select', () => {
  it('resolves a single option id to its name', () => {
    expect(formatCellValue('opt_open', status)).toBe('Open')
  })

  it('resolves multi option ids to names in selection order', () => {
    expect(formatCellValue(['opt_b', 'opt_a'], tags)).toEqual(['Beta', 'Alpha'])
  })

  it('drops an id whose option was deleted', () => {
    expect(formatCellValue('gone', status)).toBeNull()
    expect(formatCellValue(['opt_a', 'gone'], tags)).toEqual(['Alpha'])
  })

  it('renders an unset cell as null (single) and [] (multi)', () => {
    expect(formatCellValue(null, status)).toBeNull()
    expect(formatCellValue([], tags)).toEqual([])
  })
})

describe('formatCellValue — identity for non-select types', () => {
  // `rawRow` is documented public trigger output; these must pass through
  // byte-identical or deployed workflows break.
  it('passes through string, number, boolean, date and json untouched', () => {
    const json = { nested: { a: 1 } }
    expect(formatCellValue('hello', title)).toBe('hello')
    expect(formatCellValue(-5, count)).toBe(-5)
    expect(formatCellValue(false, done)).toBe(false)
    expect(formatCellValue('2026-07-06T16:04:55-07:00', due)).toBe('2026-07-06T16:04:55-07:00')
    expect(formatCellValue('2026-07-06', due)).toBe('2026-07-06')
    expect(formatCellValue(json, meta)).toBe(json)
  })

  it('passes a json column holding a plain string through unquoted', () => {
    expect(formatCellValue('https://example.com', meta)).toBe('https://example.com')
  })

  it('passes null and undefined through', () => {
    expect(formatCellValue(null, title)).toBeNull()
    expect(formatCellValue(undefined, title)).toBeUndefined()
  })
})

describe('namedRowMapper', () => {
  const toNamed = namedRowMapper([title, status, tags])

  it('translates keys and select values in one pass', () => {
    expect(
      toNamed({ col_title: 'Login broken', col_status: 'opt_open', col_tags: ['opt_a'] })
    ).toEqual({ Title: 'Login broken', Status: 'Open', Tags: ['Alpha'] })
  })

  it('drops keys with no matching column', () => {
    expect(toNamed({ col_title: 'x', col_deleted: 'orphan' })).toEqual({ Title: 'x' })
  })

  it('omits absent columns rather than filling them', () => {
    expect(toNamed({ col_title: 'x' })).toEqual({ Title: 'x' })
  })

  it('round-trips a name through id keying', () => {
    expect(toNamed({ col_title: 'x' })).toHaveProperty('Title')
  })

  it('translates only the columns it was built with', () => {
    const partial = namedRowMapper([title])
    expect(partial({ col_title: 'x', col_status: 'opt_open' })).toEqual({ Title: 'x' })
  })
})

describe('fillMissingColumns', () => {
  const columns = [title, status, tags]

  it('emits one entry per column, absent ones as null', () => {
    expect(fillMissingColumns({ Title: 'x' }, columns)).toEqual({
      Title: 'x',
      Status: null,
      Tags: null,
    })
  })

  it('fills an absent multiselect with null, not an empty array', () => {
    // `[]` is not treated as empty by downstream emptiness checks, so filling
    // with it would change which rows enrichment skips.
    expect(fillMissingColumns({}, [tags]).Tags).toBeNull()
  })

  it('preserves already-present values including falsy ones', () => {
    expect(fillMissingColumns({ Title: '', Status: 'Open' }, columns)).toEqual({
      Title: '',
      Status: 'Open',
      Tags: null,
    })
  })

  it('is a superset of the sparse row it widens', () => {
    const toNamed = namedRowMapper(columns)
    const sparse = toNamed({ col_title: 'x', col_status: 'opt_open' })
    const dense = fillMissingColumns(sparse, columns)
    for (const [key, value] of Object.entries(sparse)) expect(dense[key]).toEqual(value)
    expect(Object.keys(dense)).toEqual(columns.map((c) => c.name))
  })
})

describe('mapInputValues', () => {
  const columns = [title, status, tags]

  it('resolves mappings keyed by column id to outward values', () => {
    expect(
      mapInputValues({ col_status: 'opt_open', col_title: 'x' }, columns, [
        { inputName: 'state', columnName: 'col_status' },
        { inputName: 'name', columnName: 'col_title' },
      ])
    ).toEqual({ state: 'Open', name: 'x' })
  })

  it('skips a mapping whose column no longer exists', () => {
    expect(
      mapInputValues({ col_title: 'x' }, columns, [
        { inputName: 'gone', columnName: 'col_deleted' },
      ])
    ).toEqual({})
  })

  it('leaves an absent cell undefined rather than formatting it', () => {
    // An absent multiselect must not become `[]` — callers' required-input
    // emptiness checks treat `[]` as present, which would run enrichments on
    // rows they currently skip.
    const out = mapInputValues({}, columns, [
      { inputName: 'state', columnName: 'col_status' },
      { inputName: 'labels', columnName: 'col_tags' },
      { inputName: 'name', columnName: 'col_title' },
    ])
    expect(out.state).toBeUndefined()
    expect(out.labels).toBeUndefined()
    expect(out.name).toBeUndefined()
  })
})
