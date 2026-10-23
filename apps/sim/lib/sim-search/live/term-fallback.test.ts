import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { searchAtlassian } from '@/lib/sim-search/live/atlassian'
import { createNativeClient, NativeSearchError } from '@/lib/sim-search/live/http'
import { searchWithAnyTermFallback } from '@/lib/sim-search/live/term-fallback'
import type { NativeDocument, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'

const input: NativeSearchInput = { query: 'contractor offboarding runbook', limit: 4, scopes: [] }

/** The any-term search's own budget, which a slow provider must not outlast. */
const BUDGET_MS = 4000

/** A caller that never cancels. */
const live = new AbortController().signal

/** Settles only when its request is cancelled, like a provider that never answers. */
const untilAborted = (signal: AbortSignal | undefined) =>
  new Promise<never>((_, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })

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
  afterEach(() => {
    vi.useRealTimers()
  })

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
    const result = await searchWithAnyTermFallback(search, input, live)
    expect(result.documents.map((document) => document.id)).toEqual([
      'exact',
      'in-title',
      'in-preview',
      'runbook',
    ])
    expect(result.nextCursor).toBeUndefined()
    expect(result.partial).toBeFalsy()
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
    const result = await searchWithAnyTermFallback(search, { ...input, limit: 2 }, live)
    expect(result.documents.map((document) => document.title)).toEqual([
      'Contractor offboarding form',
      'Runbook 0',
    ])
  })

  it('adds a few partial matches however large the page', async () => {
    const partial = Array.from({ length: 12 }, () => ({ title: 'Contractor offboarding' }))
    const search = provider(page(), page(...partial))
    const result = await searchWithAnyTermFallback(search, { ...input, limit: 20 }, live)
    expect(result.documents).toHaveLength(5)
  })

  it('never relaxes a native query, which is the caller’s exact syntax', async () => {
    const search = provider(page(), page({ id: 'loose' }))
    const native = { provider: 'confluence' as const, query: 'text ~ "runbook"' }
    expect((await searchWithAnyTermFallback(search, { ...input, native }, live)).documents).toEqual(
      []
    )
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('keeps a continuable page so its cursor continues the query that produced it', async () => {
    const strict = { ...page({ id: 'exact' }), nextCursor: 'page-2' }
    const search = provider(strict, page({ id: 'loose' }))
    expect(await searchWithAnyTermFallback(search, input, live)).toBe(strict)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('does not relax a page that is already full', async () => {
    const strict = page({}, {}, {}, {})
    const search = provider(strict, page({ id: 'loose' }))
    expect(await searchWithAnyTermFallback(search, input, live)).toBe(strict)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('does not relax a query with fewer than two distinctive terms', async () => {
    const search = provider(page(), page({ id: 'loose' }))
    await searchWithAnyTermFallback(search, { ...input, query: 'what is the runbook' }, live)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('keeps the all-terms page as partial when the provider refuses the any-term search', async () => {
    const search = provider(
      page({ id: 'exact' }),
      new NativeSearchError('rate_limited', 'Slow down')
    )
    const result = await searchWithAnyTermFallback(search, input, live)
    expect(result.documents.map((document) => document.id)).toEqual(['exact'])
    expect(result).toMatchObject({ partial: true, message: 'Slow down' })
  })

  it('propagates the caller’s cancellation during the any-term search instead of returning a page', async () => {
    const caller = new AbortController()
    const search = vi.fn(async (request: NativeSearchInput) =>
      request.textMatch === 'any' ? untilAborted(request.signal) : page({ id: 'exact' })
    )
    const result = searchWithAnyTermFallback(search, input, caller.signal)
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    caller.abort(new DOMException('Cancelled', 'AbortError'))
    await expect(result).rejects.toThrow('Cancelled')
  })

  it('keeps the all-terms page as partial when the any-term search outlasts its budget', async () => {
    vi.useFakeTimers()
    let relaxedSignal: AbortSignal | undefined
    const search = vi.fn(async (request: NativeSearchInput) => {
      if (request.textMatch !== 'any') return page({ id: 'exact' })
      relaxedSignal = request.signal
      return untilAborted(request.signal)
    })
    let settled = false
    const result = searchWithAnyTermFallback(search, input, live).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(BUDGET_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const searched = await result
    expect(relaxedSignal?.aborted).toBe(true)
    expect(searched.documents.map((document) => document.id)).toEqual(['exact'])
    expect(searched).toMatchObject({ partial: true })
    expect(searched.message).toContain('some of the search terms')
  })

  it('keeps the all-terms page as partial when the any-term search fails in transport', async () => {
    const search = provider(page({ id: 'exact' }), new TypeError('fetch failed'))
    const searched = await searchWithAnyTermFallback(search, input, live)
    expect(searched.documents.map((document) => document.id)).toEqual(['exact'])
    expect(searched).toMatchObject({ partial: true })
    expect(searched.message).toContain('some of the search terms')
  })

  it('cancels a slow relaxed Jira request at the network once the budget runs out', async () => {
    vi.useFakeTimers()
    const relaxedSignals: AbortSignal[] = []
    inputValidationMockFns.mockSecureFetchWithValidation.mockImplementation(
      async (url: string, init: { body?: string; signal: AbortSignal }) => {
        if (url.endsWith('/oauth/token/accessible-resources'))
          return Response.json([{ id: 'cloud', url: 'https://acme.atlassian.net' }])
        const { jql } = JSON.parse(init.body ?? '{}') as { jql: string }
        if (!jql.includes(' OR '))
          return Response.json({ issues: [{ key: 'ENG-1', fields: { summary: 'Exact' } }] })
        relaxedSignals.push(init.signal)
        return untilAborted(init.signal)
      }
    )
    const caller = new AbortController()
    const client = createNativeClient({
      origin: 'https://api.atlassian.com',
      accessToken: 'private',
      signal: caller.signal,
    })
    const result = searchWithAnyTermFallback(
      (request) => searchAtlassian(client, 'jira', request),
      input,
      caller.signal
    )
    await vi.advanceTimersByTimeAsync(BUDGET_MS)
    const searched = await result
    expect(relaxedSignals).toHaveLength(1)
    expect(relaxedSignals[0]?.aborted).toBe(true)
    expect(caller.signal.aborted).toBe(false)
    expect(searched.documents.map((document) => document.id)).toEqual(['ENG-1'])
    expect(searched.partial).toBe(true)
  })

  it('does not relax a date-sorted search, whose page is reordered by date', async () => {
    const search = provider(page(), page({ id: 'loose' }))
    await searchWithAnyTermFallback(search, { ...input, filters: { sortBy: 'newest' } }, live)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('leaves the page untouched when the any-term search adds nothing new', async () => {
    const strict = page({ id: 'exact' })
    const search = provider(strict, page({ id: 'exact' }))
    expect(await searchWithAnyTermFallback(search, input, live)).toBe(strict)
  })
})
