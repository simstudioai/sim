/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  isVersionedType,
  normalizeEmail,
  sanitizeForJsonb,
  sanitizeValueForJsonb,
  stripVersionSuffix,
  truncate,
} from './string.js'

describe('truncate', () => {
  it('appends the suffix when the string exceeds the slice length', () => {
    expect(truncate('hello world', 8)).toBe('hello wo...')
  })

  it('uses a custom suffix when provided', () => {
    expect(truncate('hello world', 8, ' …')).toBe('hello wo …')
  })

  it('returns the original string when within the slice length', () => {
    expect(truncate('hi', 10)).toBe('hi')
  })
})

describe('stripVersionSuffix', () => {
  it('strips a trailing _vN suffix', () => {
    expect(stripVersionSuffix('notion_search_v2')).toBe('notion_search')
    expect(stripVersionSuffix('github_create_pr_v3')).toBe('github_create_pr')
  })

  it('strips multi-digit versions', () => {
    expect(stripVersionSuffix('x_v10')).toBe('x')
  })

  it('leaves plain values unchanged', () => {
    expect(stripVersionSuffix('plain')).toBe('plain')
  })

  it('does not strip a non-version trailing token', () => {
    expect(stripVersionSuffix('a_version')).toBe('a_version')
  })

  it('only strips the single trailing suffix', () => {
    expect(stripVersionSuffix('a_v2_v3')).toBe('a_v2')
  })
})

describe('isVersionedType', () => {
  it('returns true for trailing _vN suffixes', () => {
    expect(isVersionedType('notion_search_v2')).toBe(true)
    expect(isVersionedType('github_create_pr_v3')).toBe(true)
    expect(isVersionedType('x_v10')).toBe(true)
    expect(isVersionedType('a_v2_v3')).toBe(true)
  })

  it('returns false when there is no trailing version suffix', () => {
    expect(isVersionedType('plain')).toBe(false)
    expect(isVersionedType('a_version')).toBe(false)
    expect(isVersionedType('x')).toBe(false)
  })
})

describe('sanitizeForJsonb', () => {
  it('replaces a lone high surrogate left by mid-character truncation', () => {
    // '𝐀'.slice(0, 1) cuts the surrogate pair in half
    const cut = '\uD835\uDC00'.slice(0, 1)
    expect(sanitizeForJsonb(`FIFA WORLD CU${cut}`)).toBe('FIFA WORLD CU\uFFFD')
  })

  it('replaces a lone low surrogate', () => {
    expect(sanitizeForJsonb('x\uDC00y')).toBe('x\uFFFDy')
  })

  it('replaces NUL characters', () => {
    expect(sanitizeForJsonb('a\u0000b')).toBe('a\uFFFDb')
  })

  it('preserves well-formed surrogate pairs', () => {
    expect(sanitizeForJsonb('𝐅𝐈𝐅𝐀 🏆')).toBe('𝐅𝐈𝐅𝐀 🏆')
  })

  it('handles a lone high surrogate followed by a valid pair', () => {
    expect(sanitizeForJsonb('\uD835\uD835\uDC00')).toBe('\uFFFD\uD835\uDC00')
  })
})

describe('sanitizeValueForJsonb', () => {
  it('sanitizes strings nested in objects and arrays', () => {
    const input = { outline: ['ok', 'bad\uD835'], meta: { title: 'x\u0000' } }
    expect(sanitizeValueForJsonb(input)).toEqual({
      outline: ['ok', 'bad\uFFFD'],
      meta: { title: 'x\uFFFD' },
    })
  })

  it('sanitizes object keys', () => {
    expect(sanitizeValueForJsonb({ ['k\uDC00']: 1 })).toEqual({ ['k\uFFFD']: 1 })
  })

  it('returns the same reference when nothing needs rewriting', () => {
    const input = { a: ['clean', { b: 'also clean 🏆' }], n: 3 }
    expect(sanitizeValueForJsonb(input)).toBe(input)
  })

  it('passes primitives through unchanged', () => {
    expect(sanitizeValueForJsonb(42)).toBe(42)
    expect(sanitizeValueForJsonb(null)).toBe(null)
    expect(sanitizeValueForJsonb(undefined)).toBe(undefined)
  })
})

describe('normalizeEmail', () => {
  it('trims surrounding whitespace and lowercases', () => {
    expect(normalizeEmail('  USER@Example.COM  ')).toBe('user@example.com')
  })

  it('leaves an already-normalized email unchanged', () => {
    expect(normalizeEmail('user@example.com')).toBe('user@example.com')
  })
})
