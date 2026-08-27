/**
 * @vitest-environment node
 *
 * Guards `algolia_list_indices`' query string against parameter smuggling.
 *
 * `page` and `hitsPerPage` are `visibility: 'user-or-llm'`, so prompt injection
 * controls them. The tool declares them `type: 'number'`, but the Algolia block
 * declared them `type: 'string'` in `inputs` and its `tools.config.params`
 * copies values through verbatim, so a string genuinely reaches the URL
 * builder. Interpolating that string into `page=${value}` lets one parameter
 * carry a `&`, appending arbitrary further query parameters to a request that
 * still carries the caller's admin API key.
 *
 * Every assertion resolves the built URL through `new URL(...)` and reads
 * `searchParams`, never `includes()` on the template text: a smuggled
 * `hitsPerPage` is invisible to a substring check on `page=...` but shows up
 * as a second, separate key once the URL is actually parsed.
 */
import { describe, expect, it } from 'vitest'
import { listIndicesTool } from '@/tools/algolia/list_indices'

const BASE = { applicationId: 'APPID', apiKey: 'KEY' }

function buildUrl(extra: Record<string, unknown>): URL {
  const build = listIndicesTool.request.url as (params: Record<string, unknown>) => string
  return new URL(build({ ...BASE, ...extra }))
}

describe('algolia_list_indices query construction', () => {
  it('rejects a page value carrying a smuggled second parameter', () => {
    expect(() => buildUrl({ page: '0&hitsPerPage=1000' })).toThrow(/page/)
  })

  it('rejects a hitsPerPage value carrying a smuggled second parameter', () => {
    expect(() => buildUrl({ hitsPerPage: '1&page=99' })).toThrow(/hitsPerPage/)
  })

  it('rejects a non-numeric page outright rather than sending it', () => {
    expect(() => buildUrl({ page: 'abc' })).toThrow(/page/)
  })

  it('rejects a fractional page rather than silently truncating it', () => {
    expect(() => buildUrl({ page: '1.5' })).toThrow(/page/)
  })

  it('rejects an empty string rather than coercing it to page 0', () => {
    expect(() => buildUrl({ page: '' })).toThrow(/page/)
    expect(() => buildUrl({ hitsPerPage: '   ' })).toThrow(/hitsPerPage/)
  })

  it('rejects a negative page', () => {
    expect(() => buildUrl({ page: -1 })).toThrow(/page/)
  })

  it('encodes rather than interpolates when a value survives coercion', () => {
    const url = buildUrl({ page: 2, hitsPerPage: 50 })
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('hitsPerPage')).toBe('50')
    expect([...url.searchParams.keys()]).toEqual(['page', 'hitsPerPage'])
  })

  it('accepts the numeric strings the block still forwards from a short-input', () => {
    const url = buildUrl({ page: '0', hitsPerPage: '100' })
    expect(url.searchParams.get('page')).toBe('0')
    expect(url.searchParams.get('hitsPerPage')).toBe('100')
    expect([...url.searchParams.keys()]).toEqual(['page', 'hitsPerPage'])
  })

  it('is byte-identical to the pre-fix output for legitimate values', () => {
    const build = listIndicesTool.request.url as (params: Record<string, unknown>) => string
    expect(build({ ...BASE })).toBe('https://APPID-dsn.algolia.net/1/indexes')
    expect(build({ ...BASE, page: 0 })).toBe('https://APPID-dsn.algolia.net/1/indexes?page=0')
    expect(build({ ...BASE, hitsPerPage: 100 })).toBe(
      'https://APPID-dsn.algolia.net/1/indexes?hitsPerPage=100'
    )
    expect(build({ ...BASE, page: 3, hitsPerPage: 25 })).toBe(
      'https://APPID-dsn.algolia.net/1/indexes?page=3&hitsPerPage=25'
    )
  })
})
