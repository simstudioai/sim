/**
 * @vitest-environment node
 *
 * Google's People API search reads from a lazy cache: "Clients should first
 * send a warmup search request with an empty query to make sure the cache has
 * the latest data." Searching cold returns stale or empty results right after a
 * contact changes — the exact sequence the shipped `find-contact` and
 * `update-contact-details` skills drive the agent through.
 *
 * These tests drive `directExecution` (the authoritative path) with a stubbed
 * `fetch` and assert on the requests it actually issues.
 * @see https://developers.google.com/people/v1/contacts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchTool } from '@/tools/google_contacts/search'

const ACCESS_TOKEN = 'ya29.test-token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let requests: URL[]

beforeEach(() => {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      requests.push(new URL(String(input)))
      return jsonResponse({ results: [{ person: { resourceName: 'people/c1' } }] })
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function search(params: Record<string, unknown> = {}) {
  return searchTool.directExecution!(
    { accessToken: ACCESS_TOKEN, query: 'ada', ...params } as any,
    undefined
  )
}

describe('google_contacts_search warmup', () => {
  it('sends the documented empty-query warmup before the search', async () => {
    await search()

    expect(requests).toHaveLength(2)
    expect(requests[0].pathname).toBe('/v1/people:searchContacts')
    expect(requests[0].searchParams.get('query')).toBe('')
    expect(requests[1].searchParams.get('query')).toBe('ada')
  })

  it('keeps the warmup cheap by requesting only names', async () => {
    await search()

    expect(requests[0].searchParams.get('readMask')).toBe('names')
    expect(requests[1].searchParams.get('readMask')).toContain('names')
    expect(requests[1].searchParams.get('readMask')!.length).toBeGreaterThan('names'.length)
  })

  it('does not send the caller pageSize on the warmup', async () => {
    await search({ pageSize: 25 })

    expect(requests[0].searchParams.get('pageSize')).toBeNull()
    expect(requests[1].searchParams.get('pageSize')).toBe('25')
  })

  it('still searches when the warmup fails', async () => {
    const responses = [jsonResponse({ error: { message: 'nope' } }, 500), jsonResponse({})]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(new URL(String(input)))
        return responses.shift()!
      })
    )

    const result = await search()

    expect(requests).toHaveLength(2)
    expect(result.success).toBe(true)
  })

  it('still searches when the warmup request throws', async () => {
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(new URL(String(input)))
        call += 1
        if (call === 1) throw new Error('network down')
        return jsonResponse({ results: [] })
      })
    )

    const result = await search()

    expect(result.success).toBe(true)
    expect(result.output.content).toBe('Found 0 contacts matching query')
  })

  it('surfaces the search error, not the warmup status', async () => {
    const responses = [
      jsonResponse({}, 200),
      jsonResponse({ error: { message: 'Request had insufficient authentication scopes.' } }, 403),
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(new URL(String(input)))
        return responses.shift()!
      })
    )

    await expect(search()).rejects.toThrow('Request had insufficient authentication scopes.')
  })
})
