/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { buildFindRegex } from './find-matches'
import type { FindFlags } from './types'
import { computeDomMatches } from './use-dom-find'

const flags = (overrides: Partial<FindFlags> = {}): FindFlags => ({
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...overrides,
})

function container(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

function matchTexts(html: string, query: string, f: Partial<FindFlags> = {}): string[] {
  const root = container(html)
  const regex = buildFindRegex(query, flags(f))!
  return computeDomMatches(root, regex).ranges.map((r) => r.toString())
}

describe('computeDomMatches', () => {
  it('finds matches across sibling text nodes and elements', () => {
    expect(matchTexts('<p>one two</p><p>two three</p>', 'two')).toEqual(['two', 'two'])
  })

  it('maps a match to the correct DOM range within a table cell', () => {
    const root = container('<table><tr><td>alpha</td><td>beta alpha</td></tr></table>')
    const regex = buildFindRegex('alpha', flags())!
    const { ranges } = computeDomMatches(root, regex)
    expect(ranges).toHaveLength(2)
    expect(ranges[0].toString()).toBe('alpha')
    expect(ranges[1].startContainer.textContent).toBe('beta alpha')
  })

  it('does not match across block boundaries', () => {
    // "one" ends the first paragraph; "two" starts the next — a query spanning them finds nothing.
    expect(matchTexts('<p>one</p><p>two</p>', 'onetwo')).toEqual([])
  })

  it('respects case-insensitive default and whole-word flag', () => {
    expect(matchTexts('<p>Cat cat category</p>', 'cat')).toEqual(['Cat', 'cat', 'cat'])
    expect(matchTexts('<p>Cat cat category</p>', 'cat', { wholeWord: true })).toEqual([
      'Cat',
      'cat',
    ])
  })

  it('ignores text inside script and style elements', () => {
    expect(matchTexts('<style>.x{color:red}</style><p>red apple</p>', 'red')).toEqual(['red'])
  })

  it('materializes and counts every match so none is unreachable', () => {
    const root = container(`<p>${'x '.repeat(5001)}</p>`)
    const regex = buildFindRegex('x', flags())!
    const { ranges, total } = computeDomMatches(root, regex)
    expect(ranges).toHaveLength(5001) // every match gets a range — nothing dropped by a cap
    expect(total).toBe(5001)
  })
})
