/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

import { POST } from '@/app/api/tools/sailpoint/query/route'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function emptyResponse(status: number): Response {
  return new Response(null, { status })
}

function tokenResponse(): Response {
  return jsonResponse({ access_token: 'token-123', token_type: 'Bearer', expires_in: 3600 })
}

const baseCreds = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
}

describe('SailPoint query route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      authType: 'internal_jwt',
    })
  })

  it('lists identities, exchanging a token then calling the v2025 endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse([{ id: 'i1', name: 'Alice' }], 200, { 'X-Total-Count': '1' })
      )

    const request = createMockRequest('POST', {
      ...baseCreds,
      tenant: 'acme-identities',
      operation: 'sailpoint_list_identities',
      filters: 'name sw "A"',
      limit: 50,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://acme-identities.api.identitynow.com/oauth/token'
    )
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://acme-identities.api.identitynow.com/v2025/identities?filters=name+sw+%22A%22&limit=50'
    )
    expect(data.output).toEqual({
      items: [{ id: 'i1', name: 'Alice' }],
      count: 1,
      totalCount: 1,
      complete: true,
      warnings: [],
    })
  })

  it('flags an empty identity result with a diagnostic warning', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse([]))

    const request = createMockRequest('POST', {
      ...baseCreds,
      tenant: 'acme-empty',
      operation: 'sailpoint_list_identities',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.output.count).toBe(0)
    expect(data.output.complete).toBe(false)
    expect(data.output.warnings).toHaveLength(1)
    expect(data.output.warnings[0]).toContain('user level')
  })

  it('posts a search body with the query object and returns results', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse([{ _type: 'identity', id: 'i1' }]))

    const request = createMockRequest('POST', {
      ...baseCreds,
      tenant: 'acme-search',
      operation: 'sailpoint_search',
      indices: 'identities',
      query: 'name:A*',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://acme-search.api.identitynow.com/v2025/search'
    )
    const searchInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(searchInit.method).toBe('POST')
    expect(JSON.parse(searchInit.body as string)).toEqual({
      indices: ['identities'],
      query: { query: 'name:A*' },
    })
    expect(data.output.results).toEqual([{ _type: 'identity', id: 'i1' }])
  })

  it('preserves the aggregation object returned by /search/aggregate', async () => {
    const aggregationResult = {
      aggregations: { department: { buckets: [{ key: 'Finance', count: 12 }] } },
      hits: [],
    }
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(aggregationResult))

    const request = createMockRequest('POST', {
      ...baseCreds,
      tenant: 'acme-aggregate',
      operation: 'sailpoint_search_aggregate',
      indices: 'identities',
      query: 'attributes.department:*',
      aggregationsDsl: { department: { terms: { field: 'attributes.department' } } },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://acme-aggregate.api.identitynow.com/v2025/search/aggregate'
    )
    const aggInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(JSON.parse(aggInit.body as string)).toEqual({
      indices: ['identities'],
      query: { query: 'attributes.department:*' },
      aggregationType: 'DSL',
      aggregationsDsl: { department: { terms: { field: 'attributes.department' } } },
    })
    // The full AggregationResult object is preserved under `item`, not dropped as an empty list.
    expect(data.output).toEqual({ item: aggregationResult })
  })

  it('rejects a search aggregate without an aggregations definition', async () => {
    const request = createMockRequest('POST', {
      ...baseCreds,
      tenant: 'acme-agg-missing',
      operation: 'sailpoint_search_aggregate',
      indices: 'identities',
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caches the token across calls with the same credentials', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse([{ id: 'a1' }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 'a2' }]))

    const makeRequest = () =>
      createMockRequest('POST', {
        ...baseCreds,
        tenant: 'acme-cache',
        operation: 'sailpoint_list_accounts',
      })

    await POST(makeRequest())
    await POST(makeRequest())

    // 1 token exchange + 2 API calls (not 4) - the token is reused
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://acme-cache.api.identitynow.com/oauth/token')
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/v2025/accounts')
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/v2025/accounts')
  })

  it('does not share a cached token across different client secrets', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse([{ id: 'a1' }]))
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse([{ id: 'a2' }]))

    const makeRequest = (secret: string) =>
      createMockRequest('POST', {
        clientId: 'shared-client',
        clientSecret: secret,
        tenant: 'acme-secret',
        operation: 'sailpoint_list_accounts',
      })

    await POST(makeRequest('secret-A'))
    await POST(makeRequest('secret-B'))

    // A different secret must not reuse the first principal's token: 2 exchanges + 2 API calls.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/oauth/token')
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/oauth/token')
  })

  it('backs off and retries on a 429 response', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(emptyResponse(429))
      .mockResolvedValueOnce(jsonResponse([{ id: 'r1' }]))

    const request = createMockRequest('POST', {
      ...baseCreds,
      tenant: 'acme-429',
      operation: 'sailpoint_list_roles',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(data.output.items).toEqual([{ id: 'r1' }])
  })

  it('accepts an access-request write (202) as accepted', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(emptyResponse(202))

    const request = createMockRequest('POST', {
      ...baseCreds,
      tenant: 'acme-grant',
      operation: 'sailpoint_request_access',
      requestedFor: ['identity-1'],
      requestedItems: [{ type: 'ENTITLEMENT', id: 'ent-1' }],
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://acme-grant.api.identitynow.com/v2025/access-requests'
    )
    expect(data.output).toEqual({ accepted: true, status: 202 })
  })

  it('rejects a revoke that targets more than one identity before calling SailPoint', async () => {
    const request = createMockRequest('POST', {
      ...baseCreds,
      tenant: 'acme-revoke',
      operation: 'sailpoint_request_access',
      requestType: 'REVOKE_ACCESS',
      requestedFor: ['identity-1', 'identity-2'],
      requestedItems: [{ type: 'ENTITLEMENT', id: 'ent-1', comment: 'offboarding' }],
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-SailPoint tenant host without sending credentials (SSRF guard)', async () => {
    const request = createMockRequest('POST', {
      ...baseCreds,
      tenant: 'evil.example.com',
      operation: 'sailpoint_list_identities',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(data.error).toContain('not an allowed')
  })

  it('accepts a full *.api.identitynow.com host', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse([{ id: 'i1' }]))

    const request = createMockRequest('POST', {
      ...baseCreds,
      tenant: 'https://acme.api.identitynow.com',
      operation: 'sailpoint_list_identities',
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://acme.api.identitynow.com/v2025/identities')
  })

  it('propagates a SailPoint error body', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          { messages: [{ locale: 'en', text: 'Insufficient access' }], trackingId: 'trk-1' },
          403
        )
      )

    const request = createMockRequest('POST', {
      ...baseCreds,
      tenant: 'acme-error',
      operation: 'sailpoint_get_identity',
      id: 'identity-1',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.success).toBe(false)
    expect(data.error).toContain('Insufficient access')
  })
})
