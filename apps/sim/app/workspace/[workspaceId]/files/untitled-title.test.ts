import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UNTITLED_NAME,
  deriveMarkdownFileName,
  headingTextFromName,
  isUntitledName,
  uniqueMarkdownName,
} from './untitled-title'

describe('untitled format single-source-of-truth', () => {
  // Guards against DEFAULT_UNTITLED_NAME / uniqueMarkdownName drifting from the isUntitledName regex:
  // the default name and its deduped siblings must always read back as "untitled".
  it('recognizes the default name and its deduped siblings as untitled', () => {
    expect(isUntitledName(DEFAULT_UNTITLED_NAME)).toBe(true)
    const second = uniqueMarkdownName(DEFAULT_UNTITLED_NAME, new Set([DEFAULT_UNTITLED_NAME]))
    expect(second).toBe('untitled (1).md')
    expect(isUntitledName(second)).toBe(true)
  })
})

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

describe('headingTextFromName', () => {
  it('strips a trailing .md extension', () => {
    expect(headingTextFromName('Q3 Planning.md')).toBe('Q3 Planning')
    expect(headingTextFromName('notes.MD')).toBe('notes')
  })
  it('leaves a name without extension untouched', () => {
    expect(headingTextFromName('Q3 Planning')).toBe('Q3 Planning')
  })
})

describe('deriveMarkdownFileName', () => {
  it('turns heading text into a .md file name', () => {
    expect(deriveMarkdownFileName('Q3 Planning')).toBe('Q3 Planning.md')
  })
  it('strips filesystem-illegal characters and collapses whitespace', () => {
    expect(deriveMarkdownFileName('Roadmap: Q3 / Q4  *draft*')).toBe('Roadmap Q3 Q4 draft.md')
  })
  it('keeps hyphens and dots inside the title', () => {
    expect(deriveMarkdownFileName('v1.2 - release-notes')).toBe('v1.2 - release-notes.md')
  })
  it('returns null when nothing usable remains', () => {
    expect(deriveMarkdownFileName('   ')).toBeNull()
    expect(deriveMarkdownFileName('///')).toBeNull()
  })

  it('does not double the extension when the heading already ends in .md', () => {
    expect(deriveMarkdownFileName('README.md')).toBe('README.md')
    expect(deriveMarkdownFileName('notes.MD')).toBe('notes.MD')
  })
  it('hard-caps the length (no ellipsis) before the extension', () => {
    const result = deriveMarkdownFileName('a'.repeat(200))
    expect(result).toBe(`${'a'.repeat(100)}.md`)
  })

  it('re-trims when the hard cap lands on a space (no "foo .md")', () => {
    // 99 non-space chars + space at index 99 → truncate(100) leaves a trailing space to re-trim away.
    const result = deriveMarkdownFileName(`${'a'.repeat(99)} bcd`)
    expect(result).toBe(`${'a'.repeat(99)}.md`)
  })
})

describe('uniqueMarkdownName', () => {
  it('returns the name unchanged when free', () => {
    expect(uniqueMarkdownName('notes.md', new Set())).toBe('notes.md')
  })
  it('appends an incrementing suffix before the extension when taken', () => {
    expect(uniqueMarkdownName('notes.md', new Set(['notes.md']))).toBe('notes (1).md')
    expect(uniqueMarkdownName('notes.md', new Set(['notes.md', 'notes (1).md']))).toBe(
      'notes (2).md'
    )
  })
})
