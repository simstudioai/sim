import { describe, expect, it, vi } from 'vitest'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import { searchWithAnyTermFallback } from '@/lib/sim-search/live/term-fallback'
import type { NativeDocument, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'

const input: NativeSearchInput = { query: 'contractor offboarding runbook', limit: 4, scopes: [] }

function page(...documents: Partial<NativeDocument>[]): NativePage {
  return {
    documents: documents.map((document, index) => ({
      id: `doc-${index}`,
      title: '',
      url: '',
      content: '',
      ...document,
    })),
  }
}

function provider(strict: NativePage, relaxed: NativePage | Error) {
  return vi.fn(async (request: NativeSearchInput) => {
    if (request.textMatch !== 'any') return strict
    if (relaxed instanceof Error) throw relaxed
    return relaxed
  })
}

describe('searchWithAnyTermFallback', () => {
  it('follows an exhausted all-terms page with partial matches, most terms first', async () => {
    const search = provider(
      page({ id: 'exact', title: 'Contractor offboarding runbook' }),
      page(
        { id: 'runbook', title: 'Runbook index' },
        { id: 'exact', title: 'Contractor offboarding runbook' },
        { id: 'in-preview', title: 'Offboarding', content: 'Steps for each contractor' },
        { id: 'in-title', title: 'Contractor offboarding form' },
        { id: 'contractors', title: 'Contractor directory' }
      )
    )
    const result = await searchWithAnyTermFallback(search, input)
    expect(result.documents.map((document) => document.id)).toEqual([
      'exact',
      'in-title',
      'in-preview',
    ])
    expect(result.nextCursor).toBeUndefined()
    expect(result.message).toContain('Few results contained every search term')
  })

  it('finds the best partial match beyond the provider’s loose top results', async () => {
    const loose = Array.from({ length: 30 }, (_, index) => ({
      id: `loose-${index}`,
      title: index === 20 ? 'Contractor offboarding form' : `Runbook ${index}`,
    }))
    const search = vi.fn(async (request: NativeSearchInput) =>
      request.textMatch === 'any'
        ? { documents: page(...loose).documents.slice(0, request.limit) }
        : page()
    )
    const result = await searchWithAnyTermFallback(search, { ...input, limit: 2 })
    expect(result.documents.map((document) => document.title)).toEqual([
      'Contractor offboarding form',
    ])
  })

  it('keeps a page sharing a few of a long query’s terms, whose preview shows only some', async () => {
    const search = provider(
      page(),
      page({ id: 'enrichments', title: 'Enrichments and Workflow Columns' })
    )
    const result = await searchWithAnyTermFallback(search, {
      ...input,
      query: 'enrichments vs workflow columns built-in email draft column',
    })
    expect(result.documents.map((document) => document.id)).toEqual(['enrichments'])
  })

  it('keeps single-term matches of a two-term query, the closest a partial match gets', async () => {
    const search = provider(page(), page({ id: 'contractor', title: 'Contractor directory' }))
    const result = await searchWithAnyTermFallback(search, {
      ...input,
      query: 'contractor offboarding',
    })
    expect(result.documents.map((document) => document.id)).toEqual(['contractor'])
  })

  it('adds a few partial matches however large the page', async () => {
    const partial = Array.from({ length: 12 }, () => ({ title: 'Contractor offboarding' }))
    const search = provider(page(), page(...partial))
    const result = await searchWithAnyTermFallback(search, { ...input, limit: 20 })
    expect(result.documents).toHaveLength(5)
  })

  it('never relaxes a native query, which is the caller’s exact syntax', async () => {
    const search = provider(page(), page({ id: 'loose' }))
    const native = { provider: 'confluence' as const, query: 'text ~ "runbook"' }
    expect((await searchWithAnyTermFallback(search, { ...input, native })).documents).toEqual([])
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('keeps a continuable page so its cursor continues the query that produced it', async () => {
    const strict = { ...page({ id: 'exact' }), nextCursor: 'page-2' }
    const search = provider(strict, page({ id: 'loose' }))
    expect(await searchWithAnyTermFallback(search, input)).toBe(strict)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('does not relax a page that is already full', async () => {
    const strict = page({}, {}, {}, {})
    const search = provider(strict, page({ id: 'loose' }))
    expect(await searchWithAnyTermFallback(search, input)).toBe(strict)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('does not relax a query with fewer than two distinctive terms', async () => {
    const search = provider(page(), page({ id: 'loose' }))
    await searchWithAnyTermFallback(search, { ...input, query: 'what is the runbook' })
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('keeps the all-terms page as partial when the provider refuses the any-term search', async () => {
    const search = provider(
      page({ id: 'exact' }),
      new NativeSearchError('rate_limited', 'Slow down')
    )
    const result = await searchWithAnyTermFallback(search, input)
    expect(result.documents.map((document) => document.id)).toEqual(['exact'])
    expect(result).toMatchObject({ partial: true, message: 'Slow down' })
  })

  it('propagates cancellation during the any-term search instead of returning a page', async () => {
    const search = provider(page({ id: 'exact' }), new DOMException('Timed out', 'TimeoutError'))
    await expect(searchWithAnyTermFallback(search, input)).rejects.toThrow('Timed out')
  })

  it('does not relax a date-sorted search, whose page is reordered by date', async () => {
    const search = provider(page(), page({ id: 'loose' }))
    await searchWithAnyTermFallback(search, { ...input, filters: { sortBy: 'newest' } })
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('leaves the page untouched when the any-term search adds nothing new', async () => {
    const strict = page({ id: 'exact' })
    const search = provider(strict, page({ id: 'exact' }))
    expect(await searchWithAnyTermFallback(search, input)).toBe(strict)
  })
})
