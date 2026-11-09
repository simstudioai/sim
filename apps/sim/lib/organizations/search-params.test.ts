/**
 * The server pins a bare Search URL to the viewer's mode. Failure modes: a URL that already names a
 * mode redirected again (a loop), a query or filter URL hijacked into Assistant, the pin dropping the
 * URL's other params, and one viewer's remembered mode applied to another on a shared browser.
 */
import { describe, expect, it } from 'vitest'
import { pinnedSearchHref, readRememberedSearchMode } from '@/lib/organizations/search-params'

const SEARCH = '/o/org-1/search'

describe('pinning a Search URL', () => {
  it.each([
    { name: 'a URL naming its mode', params: { mode: 'assistant' } },
    { name: 'a query', params: { q: 'renewal' } },
    { name: 'a source filter', params: { source: 'slack' } },
    { name: 'a recency filter', params: { updated: '7d' } },
  ])('leaves $name where it is', ({ params }) => {
    expect(pinnedSearchHref(SEARCH, params, 'assistant')).toBeNull()
  })

  it('pins a bare URL to the remembered mode, else Search', () => {
    expect(pinnedSearchHref(SEARCH, {}, 'assistant')).toBe(`${SEARCH}?mode=assistant`)
    expect(pinnedSearchHref(SEARCH, {}, null)).toBe(`${SEARCH}?mode=search`)
  })

  it('keeps the URL’s other params, and repins an unreadable mode', () => {
    const pinned = pinnedSearchHref(SEARCH, { mode: 'chat', ref: ['a', 'b'] }, 'assistant')
    const url = new URL(pinned ?? '', 'http://sim.test')
    expect(url.pathname).toBe(SEARCH)
    expect(url.searchParams.getAll('ref')).toEqual(['a', 'b'])
    expect(url.searchParams.getAll('mode')).toEqual(['assistant'])
  })
})

describe('the remembered mode', () => {
  it('belongs only to the viewer who chose it', () => {
    expect(readRememberedSearchMode('viewer:assistant', 'viewer')).toBe('assistant')
    expect(readRememberedSearchMode('viewer:assistant', 'other')).toBeNull()
    expect(readRememberedSearchMode('viewer:bogus', 'viewer')).toBeNull()
    expect(readRememberedSearchMode(undefined, 'viewer')).toBeNull()
  })
})
