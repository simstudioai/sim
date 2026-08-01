/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildFileSelectionLabel,
  buildTableSelectionLabel,
  MAX_FILE_SELECTION_TEXT_LENGTH,
  truncateSelectionText,
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

  it('falls back to just the file name when the source has no line numbers', () => {
    expect(buildFileSelectionLabel('notes.md')).toBe('notes.md')
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
})

describe('truncateSelectionText', () => {
  it('leaves text within the bound untouched', () => {
    expect(truncateSelectionText('short passage')).toBe('short passage')
  })

  it('keeps the result — ellipsis included — within the server schema bound', () => {
    const oversized = 'x'.repeat(MAX_FILE_SELECTION_TEXT_LENGTH + 500)
    const truncated = truncateSelectionText(oversized)

    expect(truncated.length).toBeLessThanOrEqual(MAX_FILE_SELECTION_TEXT_LENGTH)
    expect(truncated.length).toBeLessThan(oversized.length)
  })
})
