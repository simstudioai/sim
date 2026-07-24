/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { formatCsvCell, resolveSelectExportValue } from '@/lib/table/export-format'
import type { ColumnDefinition } from '@/lib/table/types'

const singleSelect: ColumnDefinition = {
  id: 'col_status',
  name: 'status',
  type: 'select',
  options: [
    { id: 'opt_open', name: 'Open', color: 'green' },
    { id: 'opt_closed', name: 'Closed', color: 'red' },
  ],
}

const multiSelect: ColumnDefinition = {
  id: 'col_tags',
  name: 'tags',
  type: 'select',
  multiple: true,
  options: [
    { id: 'opt_a', name: 'Alpha', color: 'blue' },
    { id: 'opt_b', name: 'Beta', color: 'purple' },
  ],
}

describe('resolveSelectExportValue', () => {
  it('maps a single option id to its name', () => {
    expect(resolveSelectExportValue(singleSelect, 'opt_open')).toBe('Open')
  })

  it('maps multi option ids to a names array in order', () => {
    expect(resolveSelectExportValue(multiSelect, ['opt_b', 'opt_a'])).toEqual(['Beta', 'Alpha'])
  })

  it('drops ids with no matching option', () => {
    expect(resolveSelectExportValue(multiSelect, ['opt_a', 'gone'])).toEqual(['Alpha'])
  })

  it('returns null for an empty single value', () => {
    expect(resolveSelectExportValue(singleSelect, null)).toBeNull()
  })
})

describe('formatCsvCell', () => {
  it('renders the option name, not the id', () => {
    expect(formatCsvCell(singleSelect, 'opt_closed')).toBe('Closed')
  })

  it('comma-joins multi option names', () => {
    expect(formatCsvCell(multiSelect, ['opt_a', 'opt_b'])).toBe('Alpha, Beta')
  })

  it('is empty when nothing is selected', () => {
    expect(formatCsvCell(singleSelect, null)).toBe('')
    expect(formatCsvCell(multiSelect, [])).toBe('')
  })

  it('falls through to the plain formatter for non-select columns', () => {
    const num: ColumnDefinition = { id: 'c', name: 'n', type: 'number' }
    expect(formatCsvCell(num, 42)).toBe('42')
  })
})
