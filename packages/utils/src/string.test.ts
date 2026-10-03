import { describe, expect, it } from 'vitest'
import {
  compareStrings,
  escapeRegExp,
  forEachSearchOccurrence,
  projectEscapedMarkdownForSearch,
  sanitizeForJsonb,
  sanitizeValueForJsonb,
  truncateAtCodePoint,
} from './string.js'

describe('sanitizeForJsonb', () => {
  it('replaces a lone high surrogate left by mid-character truncation', () => {
    // '𝐀'.slice(0, 1) cuts the surrogate pair in half
    const cut = '\uD835\uDC00'.slice(0, 1)
    expect(sanitizeForJsonb(`FIFA WORLD CU${cut}`)).toBe('FIFA WORLD CU\uFFFD')
  })

  it('replaces NUL characters', () => {
    expect(sanitizeForJsonb('a\u0000b')).toBe('a\uFFFDb')
  })

  it('handles a lone high surrogate followed by a valid pair', () => {
    expect(sanitizeForJsonb('\uD835\uD835\uDC00')).toBe('\uFFFD\uD835\uDC00')
  })
})

describe('sanitizeValueForJsonb', () => {
  it('returns the same reference when nothing needs rewriting', () => {
    const input = { a: ['clean', { b: 'also clean 🏆' }], n: 3 }
    expect(sanitizeValueForJsonb(input)).toBe(input)
  })
})

describe('projectEscapedMarkdownForSearch', () => {
  /* The span must cover the backslash, or replacing a match would leave it stranded. */
  it('maps a projected range back over the escape it consumed', () => {
    const source = 'x SB\\_ACTION y'
    const { text, starts } = projectEscapedMarkdownForSearch(source)
    const start = text.indexOf('SB_ACTION')
    const end = start + 'SB_ACTION'.length
    expect(source.slice(starts[start], starts[end])).toBe('SB\\_ACTION')
  })

  it('maps every position when escapes repeat', () => {
    const source = 'a\\_b\\_c'
    const { text, starts } = projectEscapedMarkdownForSearch(source)
    expect(text).toBe('a_b_c')
    for (let i = 0; i < text.length; i += 1) {
      expect(source.slice(starts[i], starts[i + 1]).endsWith(text[i])).toBe(true)
    }
    expect(starts[text.length]).toBe(source.length)
  })
})

describe('forEachSearchOccurrence', () => {
  const spans = (text: string, query: string, caseSensitive?: boolean) => {
    const found: string[] = []
    forEachSearchOccurrence(
      text,
      query,
      (start, end) => found.push(text.slice(start, end)),
      caseSensitive
    )
    return found
  }

  it('keeps context-sensitive lowercasing in the length-preserving fallback', () => {
    // '\u0130' expands, so the whole-string fast path is unavailable. Folding the rest character by
    // character would lowercase the word-final '\u03a3' to '\u03c3' instead of '\u03c2', making one
    // unrelated code point change how every sigma in the string matches.
    expect(spans('\u0130\u03a3', '\u0130\u03c2')).toEqual(['\u0130\u03a3'])
  })

  it('reports bounds into the caller\u2019s own string after a length-changing lowercase', () => {
    // '\u0130'.toLowerCase() is TWO characters. A plain lowercase would slide every later index by
    // one, so the caller would slice the wrong span out of the string it passed in.
    expect(spans('\u0130xyz target', 'target')).toEqual(['target'])
  })
})

describe('escapeRegExp', () => {
  it('escapes every occurrence, not just the first', () => {
    expect(escapeRegExp('a.b.c')).toBe('a\\.b\\.c')
  })
})

describe('compareStrings', () => {
  it('sorts uppercase before lowercase, unlike localeCompare', () => {
    expect(compareStrings('Z', 'a')).toBe(-1)
    expect(['a', 'Z'].sort(compareStrings)).toEqual(['Z', 'a'])
  })
})

describe('truncateAtCodePoint', () => {
  it('moves the cut back one unit rather than splitting a surrogate pair', () => {
    expect(truncateAtCodePoint('ab😀cd', 3)).toBe('ab...')
    expect(truncateAtCodePoint('😀'.repeat(3), 3)).toBe('😀...')
  })
})
