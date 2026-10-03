import { describe, expect, it } from 'vitest'
import { deriveMarkdownFileName, isUntitledName, uniqueMarkdownName } from './untitled-title'

describe('isUntitledName', () => {
  it.each([
    ['untitled.md', true],
    ['untitled (1).md', true],
    ['untitled (23).md', true],
    ['Untitled.md', false],
    ['untitled.txt', false],
    ['untitled', false],
    ['my notes.md', false],
    ['untitled draft.md', false],
    ['untitled ().md', false],
  ])('%s → %s', (name, expected) => {
    expect(isUntitledName(name)).toBe(expected)
  })
})

describe('deriveMarkdownFileName', () => {
  it('strips filesystem-illegal characters and collapses whitespace', () => {
    expect(deriveMarkdownFileName('Roadmap: Q3 / Q4  *draft*')).toBe('Roadmap Q3 Q4 draft.md')
  })

  it('re-trims when the hard cap lands on a space (no "foo .md")', () => {
    // 99 non-space chars + space at index 99 → truncate(100) leaves a trailing space to re-trim away.
    const result = deriveMarkdownFileName(`${'a'.repeat(99)} bcd`)
    expect(result).toBe(`${'a'.repeat(99)}.md`)
  })
})

describe('uniqueMarkdownName', () => {
  it('appends an incrementing suffix before the extension when taken', () => {
    expect(uniqueMarkdownName('notes.md', new Set(['notes.md']))).toBe('notes (1).md')
    expect(uniqueMarkdownName('notes.md', new Set(['notes.md', 'notes (1).md']))).toBe(
      'notes (2).md'
    )
  })
})
