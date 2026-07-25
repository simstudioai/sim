/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildPiSearchProviderArgs,
  extractPiSearchRecords,
  normalizePiSearchRecords,
  PI_SEARCH_DEFAULT_RESULTS,
  PI_SEARCH_MAX_DATE_LENGTH,
  PI_SEARCH_MAX_ENVELOPE_BYTES,
  PI_SEARCH_MAX_QUERY_LENGTH,
  PI_SEARCH_MAX_RESULTS,
  PI_SEARCH_MAX_SNIPPET_LENGTH,
  PI_SEARCH_MAX_TITLE_LENGTH,
  PI_SEARCH_TOOL_PARAMETERS,
  parsePiSearchArgs,
  serializePiSearchEnvelope,
} from '@/executor/handlers/pi/search/normalize'

describe('parsePiSearchArgs', () => {
  it('requires a non-blank query', () => {
    expect(() => parsePiSearchArgs({})).toThrow(/query is required/)
    expect(() => parsePiSearchArgs({ query: '   ' })).toThrow(/query is required/)
  })

  it('defaults the result count when absent or unparseable', () => {
    expect(parsePiSearchArgs({ query: 'pi' }).numResults).toBe(PI_SEARCH_DEFAULT_RESULTS)
    expect(parsePiSearchArgs({ query: 'pi', numResults: 'many' }).numResults).toBe(
      PI_SEARCH_DEFAULT_RESULTS
    )
  })

  it('clamps the result count instead of failing the call', () => {
    expect(parsePiSearchArgs({ query: 'pi', numResults: 0 }).numResults).toBe(1)
    expect(parsePiSearchArgs({ query: 'pi', numResults: 500 }).numResults).toBe(
      PI_SEARCH_MAX_RESULTS
    )
    expect(parsePiSearchArgs({ query: 'pi', numResults: 3.7 }).numResults).toBe(3)
  })

  it('trims and caps the query', () => {
    expect(parsePiSearchArgs({ query: '  pi coding agent  ' }).query).toBe('pi coding agent')
    expect(parsePiSearchArgs({ query: 'x'.repeat(5000) }).query).toHaveLength(
      PI_SEARCH_MAX_QUERY_LENGTH
    )
  })
})

describe('PI_SEARCH_TOOL_PARAMETERS', () => {
  it('exposes only query and numResults, so provider knobs stay unreachable', () => {
    expect(Object.keys(PI_SEARCH_TOOL_PARAMETERS.properties)).toEqual(['query', 'numResults'])
    expect(PI_SEARCH_TOOL_PARAMETERS.additionalProperties).toBe(false)
    expect(PI_SEARCH_TOOL_PARAMETERS.required).toEqual(['query'])
  })
})

describe('buildPiSearchProviderArgs', () => {
  const query = { query: 'ts 5.9 release notes', numResults: 3 }

  it('maps the bounded query onto each provider parameter name', () => {
    expect(buildPiSearchProviderArgs('exa', query)).toEqual({
      query: 'ts 5.9 release notes',
      numResults: 3,
      text: { maxCharacters: expect.any(Number) },
    })
    expect(buildPiSearchProviderArgs('serper', query)).toEqual({
      query: 'ts 5.9 release notes',
      num: 3,
    })
    expect(buildPiSearchProviderArgs('parallel', query)).toEqual({
      objective: 'ts 5.9 release notes',
      max_results: 3,
    })
    expect(buildPiSearchProviderArgs('firecrawl', query)).toEqual({
      query: 'ts 5.9 release notes',
      limit: 3,
    })
  })
})

describe('extractPiSearchRecords', () => {
  it('reads each provider result collection and tolerates a missing one', () => {
    expect(extractPiSearchRecords('exa', { results: [{ url: 'a' }] })).toHaveLength(1)
    expect(extractPiSearchRecords('exa', {})).toEqual([])
    expect(extractPiSearchRecords('exa', null)).toEqual([])
    expect(extractPiSearchRecords('parallel', { results: [{ url: 'a' }] })).toHaveLength(1)
  })

  it('accepts both Serper shapes, since the host and sandbox paths differ', () => {
    expect(extractPiSearchRecords('serper', { searchResults: [{ link: 'a' }] })).toHaveLength(1)
    expect(extractPiSearchRecords('serper', { organic: [{ link: 'a' }] })).toHaveLength(1)
  })

  it('accepts Firecrawl data as an array or as a per-source map', () => {
    expect(extractPiSearchRecords('firecrawl', { data: [{ url: 'a' }] })).toHaveLength(1)
    expect(
      extractPiSearchRecords('firecrawl', { data: { web: [{ url: 'a' }, { url: 'b' }] } })
    ).toHaveLength(2)
    expect(extractPiSearchRecords('firecrawl', { data: null })).toEqual([])
  })
})

describe('normalizePiSearchRecords', () => {
  it('normalizes Exa records and prefers text over summary', () => {
    expect(
      normalizePiSearchRecords(
        'exa',
        [
          {
            title: 'Release notes',
            url: 'https://example.com/a',
            text: 'Full page text',
            summary: 'Short summary',
            publishedDate: '2026-01-02',
          },
        ],
        5
      )
    ).toEqual([
      {
        title: 'Release notes',
        url: 'https://example.com/a',
        snippet: 'Full page text',
        publishedDate: '2026-01-02',
      },
    ])
  })

  it('falls back to the first non-empty Exa highlight', () => {
    const [result] = normalizePiSearchRecords(
      'exa',
      [{ title: 'T', url: 'https://example.com/a', highlights: ['', 'Second highlight'] }],
      5
    )
    expect(result.snippet).toBe('Second highlight')
  })

  it('normalizes Serper records from either link field', () => {
    expect(
      normalizePiSearchRecords(
        'serper',
        [
          { title: 'A', link: 'https://example.com/a', snippet: 'Snippet A', date: '1 day ago' },
          { title: 'B', url: 'https://example.com/b', snippet: 'Snippet B' },
        ],
        5
      )
    ).toEqual([
      {
        title: 'A',
        url: 'https://example.com/a',
        snippet: 'Snippet A',
        publishedDate: '1 day ago',
      },
      { title: 'B', url: 'https://example.com/b', snippet: 'Snippet B' },
    ])
  })

  it('normalizes Parallel excerpts and its nulled-out fields', () => {
    expect(
      normalizePiSearchRecords(
        'parallel',
        [
          {
            title: null,
            url: 'https://example.com/a',
            publish_date: null,
            excerpts: ['First excerpt'],
          },
        ],
        5
      )
    ).toEqual([{ title: '(untitled)', url: 'https://example.com/a', snippet: 'First excerpt' }])
  })

  it('normalizes Firecrawl records, which carry no date', () => {
    expect(
      normalizePiSearchRecords(
        'firecrawl',
        [{ title: 'A', url: 'https://example.com/a', description: 'Described' }],
        5
      )
    ).toEqual([{ title: 'A', url: 'https://example.com/a', snippet: 'Described' }])
  })

  it('drops records without a usable http(s) link', () => {
    expect(
      normalizePiSearchRecords(
        'exa',
        [
          { title: 'No url', url: null },
          { title: 'File', url: 'file:///etc/passwd' },
          { title: 'Script', url: 'javascript:alert(1)' },
          { title: 'Long', url: `https://example.com/${'x'.repeat(4000)}` },
          'not an object',
          { title: 'Kept', url: 'https://example.com/ok' },
        ],
        5
      )
    ).toEqual([{ title: 'Kept', url: 'https://example.com/ok', snippet: '(no snippet)' }])
  })

  it('honors the requested limit', () => {
    const records = Array.from({ length: 9 }, (_, i) => ({
      title: `T${i}`,
      url: `https://example.com/${i}`,
    }))
    expect(normalizePiSearchRecords('exa', records, 2)).toHaveLength(2)
  })

  it('collapses whitespace and caps each display field', () => {
    const [result] = normalizePiSearchRecords(
      'exa',
      [
        {
          title: `  spaced\n\ttitle  ${'t'.repeat(400)}`,
          url: 'https://example.com/a',
          text: 's'.repeat(3000),
          publishedDate: `${'d'.repeat(80)}`,
        },
      ],
      1
    )
    expect(result.title).toHaveLength(PI_SEARCH_MAX_TITLE_LENGTH)
    expect(result.title.startsWith('spaced title')).toBe(true)
    expect(result.snippet).toHaveLength(PI_SEARCH_MAX_SNIPPET_LENGTH)
    expect(result.publishedDate).toHaveLength(PI_SEARCH_MAX_DATE_LENGTH)
  })
})

describe('serializePiSearchEnvelope', () => {
  it('reports an empty search with a message rather than an error', () => {
    expect(serializePiSearchEnvelope([])).toBe('{"results":[],"message":"No results found."}')
  })

  it('emits parseable JSON and omits an absent date', () => {
    const parsed = JSON.parse(
      serializePiSearchEnvelope([{ title: 'A', url: 'https://example.com/a', snippet: 'S' }])
    )
    expect(parsed).toEqual({
      results: [{ title: 'A', url: 'https://example.com/a', snippet: 'S' }],
    })
    expect('publishedDate' in parsed.results[0]).toBe(false)
  })

  // The per-field caps count UTF-16 units, so ten maximal results only exceed the byte ceiling once
  // the text is multi-byte — which is exactly the case a character-counted cap alone would miss.
  it('drops whole results to fit the byte ceiling, never truncating mid-string', () => {
    const results = Array.from({ length: 10 }, (_, i) => ({
      title: '見'.repeat(PI_SEARCH_MAX_TITLE_LENGTH),
      url: `https://example.com/${i}?${'q'.repeat(1500)}`,
      snippet: '漢'.repeat(PI_SEARCH_MAX_SNIPPET_LENGTH),
    }))
    const serialized = serializePiSearchEnvelope(results)

    expect(new TextEncoder().encode(serialized).length).toBeLessThanOrEqual(
      PI_SEARCH_MAX_ENVELOPE_BYTES
    )
    const parsed = JSON.parse(serialized)
    expect(parsed.results.length).toBeGreaterThan(0)
    expect(parsed.results.length).toBeLessThan(10)
    expect(parsed.results[0].snippet).toHaveLength(PI_SEARCH_MAX_SNIPPET_LENGTH)
  })
})
