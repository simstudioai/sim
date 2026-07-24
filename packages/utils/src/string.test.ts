/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  formatQuotedNameList,
  isVersionedType,
  normalizeEmail,
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

describe('normalizeEmail', () => {
  it('trims surrounding whitespace and lowercases', () => {
    expect(normalizeEmail('  USER@Example.COM  ')).toBe('user@example.com')
  })

  it('leaves an already-normalized email unchanged', () => {
    expect(normalizeEmail('user@example.com')).toBe('user@example.com')
  })
})

describe('formatQuotedNameList', () => {
  it('lists all names quoted when within the cap', () => {
    expect(formatQuotedNameList(['A', 'B'], 3)).toBe('"A", "B"')
  })

  it('truncates to the cap with an overflow tail', () => {
    expect(formatQuotedNameList(['A', 'B', 'C', 'D', 'E'], 3)).toBe('"A", "B", "C" and 2 more')
  })

  it('returns an empty string for no names', () => {
    expect(formatQuotedNameList([], 3)).toBe('')
  })
})
