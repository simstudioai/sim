/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildFindRegex, escapeRegExp, findRanges } from './find-matches'
import type { FindFlags } from './types'

const flags = (overrides: Partial<FindFlags> = {}): FindFlags => ({
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...overrides,
})

const rangesFor = (text: string, query: string, f: Partial<FindFlags> = {}) => {
  const regex = buildFindRegex(query, flags(f))
  if (!regex) return null
  return findRanges(text, regex).map((r) => text.slice(r.start, r.end))
}

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b*c?(d)')).toBe('a\\.b\\*c\\?\\(d\\)')
  })
})

describe('buildFindRegex', () => {
  it('returns null for an empty query', () => {
    expect(buildFindRegex('', flags())).toBeNull()
  })

  it('returns null for an invalid regex in regex mode', () => {
    expect(buildFindRegex('(', flags({ regex: true }))).toBeNull()
  })

  it('treats metacharacters literally in literal mode', () => {
    expect(rangesFor('a.b and axb', 'a.b')).toEqual(['a.b'])
  })

  it('honors metacharacters in regex mode', () => {
    expect(rangesFor('a.b and axb', 'a.b', { regex: true })).toEqual(['a.b', 'axb'])
  })

  it('is case-insensitive by default and case-sensitive when set', () => {
    expect(rangesFor('Foo foo FOO', 'foo')).toEqual(['Foo', 'foo', 'FOO'])
    expect(rangesFor('Foo foo FOO', 'foo', { caseSensitive: true })).toEqual(['foo'])
  })

  it('matches whole words only when wholeWord is set', () => {
    expect(rangesFor('cat category cat', 'cat')).toEqual(['cat', 'cat', 'cat'])
    expect(rangesFor('cat category cat', 'cat', { wholeWord: true })).toEqual(['cat', 'cat'])
  })
})

describe('findRanges', () => {
  it('reports correct offsets', () => {
    const regex = buildFindRegex('lo', flags())!
    const ranges = findRanges('hello world lo', regex)
    expect(ranges.map((r) => [r.start, r.end])).toEqual([
      [3, 5],
      [12, 14],
    ])
  })

  it('does not infinite-loop on zero-length regex matches', () => {
    const regex = buildFindRegex('a*', flags({ regex: true }))!
    const ranges = findRanges('baab', regex)
    expect(ranges.map((r) => [r.start, r.end])).toEqual([[1, 3]])
  })

  it('enumerates every match so none is dropped by a cap', () => {
    const regex = buildFindRegex('a', flags())!
    expect(findRanges('aaaaa', regex)).toHaveLength(5)
  })

  it('captures groups', () => {
    const regex = buildFindRegex('(\\w+)@(\\w+)', flags({ regex: true }))!
    const [range] = findRanges('a@b', regex)
    expect(range.groups).toEqual(['a@b', 'a', 'b'])
  })
})
