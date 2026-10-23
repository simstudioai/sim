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

describe('formatCellValue — select', () => {
  it('drops an id whose option was deleted', () => {
    expect(formatCellValue('gone', status)).toBeNull()
    expect(formatCellValue(['opt_a', 'gone'], tags)).toEqual(['Alpha'])
  })

  it('renders an unset cell as null (single) and [] (multi)', () => {
    expect(formatCellValue(null, status)).toBeNull()
    expect(formatCellValue([], tags)).toEqual([])
  })
})

describe('namedRowMapper', () => {
  const toNamed = namedRowMapper([title, status, tags])

  it('translates keys and select values in one pass', () => {
    expect(
      toNamed({ col_title: 'Login broken', col_status: 'opt_open', col_tags: ['opt_a'] })
    ).toEqual({ Title: 'Login broken', Status: 'Open', Tags: ['Alpha'] })
  })
})

describe('fillMissingColumns', () => {
  const columns = [title, status, tags]

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
})

describe('mapInputValues', () => {
  const columns = [title, status, tags]

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
