/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildFileSelectionLabel,
  buildTableSelectionLabel,
  fileNameFromSelectionLabel,
  selectionKey,
  tableNameFromSelectionLabel,
} from './selection-context'

describe('buildFileSelectionLabel', () => {
  it('renders a line range', () => {
    expect(buildFileSelectionLabel('notes.md', 12, 40)).toBe('notes.md:12-40')
  })

  it('renders a single line when start equals end', () => {
    expect(buildFileSelectionLabel('notes.md', 12, 12)).toBe('notes.md:12')
  })

  it('renders a single line when only start is known', () => {
    expect(buildFileSelectionLabel('notes.md', 12)).toBe('notes.md:12')
  })

  it('falls back to just the file name with no line info', () => {
    expect(buildFileSelectionLabel('notes.md')).toBe('notes.md')
  })

  it('appends the disambiguation key when provided', () => {
    expect(buildFileSelectionLabel('notes.md', 12, 40, 'k3f9')).toBe('notes.md:12-40 #k3f9')
    expect(buildFileSelectionLabel('notes.md', undefined, undefined, 'k3f9')).toBe('notes.md #k3f9')
  })
})

describe('buildTableSelectionLabel', () => {
  it('pluralizes rows and omits columns for whole-row selections', () => {
    expect(buildTableSelectionLabel('Sales', 5)).toBe('Sales (5 rows)')
    expect(buildTableSelectionLabel('Sales', 1)).toBe('Sales (1 row)')
  })

  it('includes column count for a cell range', () => {
    expect(buildTableSelectionLabel('Sales', 5, 3)).toBe('Sales (5 rows, 3 cols)')
    expect(buildTableSelectionLabel('Sales', 2, 1)).toBe('Sales (2 rows, 1 col)')
  })

  it('appends the disambiguation key when provided', () => {
    expect(buildTableSelectionLabel('Sales', 2, undefined, 'k3f9')).toBe('Sales (2 rows #k3f9)')
    expect(buildTableSelectionLabel('Sales', 2, 3, 'k3f9')).toBe('Sales (2 rows, 3 cols #k3f9)')
  })
})

describe('selectionKey', () => {
  it('is deterministic and order-independent', () => {
    expect(selectionKey(['r1', 'r2', 'r3'])).toBe(selectionKey(['r3', 'r1', 'r2']))
  })

  it('differs for distinct id sets of the same size', () => {
    expect(selectionKey(['r1', 'r2'])).not.toBe(selectionKey(['r3', 'r4']))
  })
})

describe('selection-label name recovery', () => {
  it('strips the line suffix from a file selection label', () => {
    expect(fileNameFromSelectionLabel('notes.md:12-40')).toBe('notes.md')
    expect(fileNameFromSelectionLabel('notes.md')).toBe('notes.md')
  })

  it('strips the disambiguation key and line suffix from a file selection label', () => {
    expect(fileNameFromSelectionLabel('notes.md:12-40 #k3f9')).toBe('notes.md')
    expect(fileNameFromSelectionLabel('notes.md #k3f9')).toBe('notes.md')
  })

  it('strips rows/cols/key suffix from a table selection label', () => {
    expect(tableNameFromSelectionLabel('Sales (2 rows)')).toBe('Sales')
    expect(tableNameFromSelectionLabel('Sales (2 rows, 3 cols #k3f9)')).toBe('Sales')
    expect(tableNameFromSelectionLabel('Sales (5 rows #ab12)')).toBe('Sales')
  })
})
