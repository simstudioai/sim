import { describe, expect, it } from 'vitest'
import {
  buildFileSelectionLabel,
  MAX_FILE_SELECTION_TEXT_LENGTH,
  truncateSelectionText,
} from './selection-context'

describe('buildFileSelectionLabel', () => {
  it('marks a line-less selection so it cannot collide with the whole-file chip', () => {
    // A bare 'notes.md' would equal the whole-file chip's label, and menu inserts
    // silently reject an already-taken label — blocking the file's own mention.
    expect(buildFileSelectionLabel('notes.md')).toBe('notes.md (selection)')
    expect(buildFileSelectionLabel('notes.md')).not.toBe('notes.md')
  })
})

describe('truncateSelectionText', () => {
  it('keeps the result — ellipsis included — within the server schema bound', () => {
    const oversized = 'x'.repeat(MAX_FILE_SELECTION_TEXT_LENGTH + 500)
    const truncated = truncateSelectionText(oversized)

    expect(truncated.length).toBeLessThanOrEqual(MAX_FILE_SELECTION_TEXT_LENGTH)
    expect(truncated.length).toBeLessThan(oversized.length)
  })
})
