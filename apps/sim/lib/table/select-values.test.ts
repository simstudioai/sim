/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveFilterSelectValues, selectValueToNames } from '@/lib/table/select-values'
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
  it('maps a single option id to its name', () => {
    expect(selectValueToNames(status, 'opt_open')).toBe('Open')
  })

  it('returns null for an empty single value', () => {
    expect(selectValueToNames(status, null)).toBeNull()
    expect(selectValueToNames(status, '')).toBeNull()
  })

  it('drops a single id with no matching option', () => {
    expect(selectValueToNames(status, 'gone')).toBeNull()
  })

  it('maps multi ids to a names array in order', () => {
    expect(selectValueToNames(tags, ['opt_b', 'opt_a'])).toEqual(['Beta', 'Alpha'])
  })

  it('drops orphaned ids in a multi value', () => {
    expect(selectValueToNames(tags, ['opt_a', 'gone'])).toEqual(['Alpha'])
  })

  it('returns an empty array for an empty multi value', () => {
    expect(selectValueToNames(tags, [])).toEqual([])
  })
})

// Row-level select resolution now lives in `__tests__/cell-format.test.ts`,
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

  it('accepts an id verbatim (idempotent) and leaves unknown values as-is', () => {
    expect(resolveFilterSelectValues({ col_status: 'opt_open' }, columns)).toEqual({
      col_status: 'opt_open',
    })
    expect(resolveFilterSelectValues({ col_status: 'Nope' }, columns)).toEqual({
      col_status: 'Nope',
    })
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
