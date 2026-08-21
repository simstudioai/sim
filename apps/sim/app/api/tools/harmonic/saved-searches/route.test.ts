/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS } from '@/lib/api/contracts/selectors/harmonic'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

const {
  mockAuthorizeCredentialUse,
  mockCheckSessionOrInternalAuth,
  mockFetch,
  mockResolveCredentialAccessToken,
  mockResolveOAuthAccountId,
} = vi.hoisted(() => ({
  mockAuthorizeCredentialUse: vi.fn(),
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockFetch: vi.fn(),
  mockResolveCredentialAccessToken: vi.fn(),
  mockResolveOAuthAccountId: vi.fn(),
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mockAuthorizeCredentialUse,
}))
vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))
vi.mock('@/lib/oauth/credential-service', () => ({
  resolveCredentialAccessToken: mockResolveCredentialAccessToken,
  resolveOAuthAccountId: mockResolveOAuthAccountId,
}))

import { POST } from '@/app/api/tools/harmonic/saved-searches/route'

const URL = 'http://localhost:3000/api/tools/harmonic/saved-searches'
const REQUEST_BODY = { credential: 'credential-1', workflowId: 'workflow-1' } as const

function request(
  body: unknown,
  signal?: AbortSignal,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal,
  })
}

function providerResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function peopleSearch(id: number, name = `Search ${id}`) {
  return {
    id,
    entity_urn: `urn:harmonic:saved_search:${id}`,
    name,
    type: 'PERSONS',
    query: { confidential: 'not returned' },
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

describe('POST /api/tools/harmonic/saved-searches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'caller-1' })
    mockAuthorizeCredentialUse.mockResolvedValue({
      ok: true,
      credentialOwnerUserId: 'owner-1',
      resolvedCredentialId: 'resolved-credential-1',
      credentialType: 'service_account',
    })
    mockResolveOAuthAccountId.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'harmonic-service-account',
    })
    mockResolveCredentialAccessToken.mockResolvedValue({ accessToken: 'server-only-api-key' })
    mockFetch.mockResolvedValue(providerResponse([]))
  })

  afterAll(() => vi.unstubAllGlobals())

  it.each([
    ['unauthenticated malformed input', '{not-json', {}, 'Unauthorized'],
    [
      'external API-key caller',
      REQUEST_BODY,
      { 'x-api-key': 'external-key' },
      'API key access not allowed for this endpoint',
    ],
  ])('authenticates before parsing an %s', async (_label, body, headers, error) => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({ success: false, error })

    const response = await POST(request(body, undefined, headers), {})

    expect(response.status).toBe(401)
    expect(await json(response)).toMatchObject({ error })
    expect(mockAuthorizeCredentialUse).not.toHaveBeenCalled()
    expect(mockResolveOAuthAccountId).not.toHaveBeenCalled()
    expect(mockResolveCredentialAccessToken).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid JSON', '{not-json', 400],
    ['missing credential', { workflowId: 'workflow-1' }, 400],
    ['blank workflow', { credential: 'credential-1', workflowId: ' ' }, 400],
    ['unknown property', { ...REQUEST_BODY, apiKey: 'must-not-be-accepted' }, 400],
    ['oversized request', { ...REQUEST_BODY, padding: 'x'.repeat(9 * 1024) }, 413],
  ])('rejects %s before credential access', async (_label, body, expectedStatus) => {
    const response = await POST(request(body), {})

    expect(response.status).toBe(expectedStatus)
    expect(mockAuthorizeCredentialUse).not.toHaveBeenCalled()
    expect(mockResolveOAuthAccountId).not.toHaveBeenCalled()
    expect(mockResolveCredentialAccessToken).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('authorizes the exact workflow credential before metadata, secret resolution, and egress', async () => {
    const response = await POST(request(REQUEST_BODY), {})

    expect(response.status).toBe(200)
    expect(mockAuthorizeCredentialUse).toHaveBeenCalledWith(expect.any(NextRequest), {
      credentialId: 'credential-1',
      workflowId: 'workflow-1',
      callerUserId: 'caller-1',
    })
    expect(mockResolveOAuthAccountId).toHaveBeenCalledWith('resolved-credential-1')
    expect(mockResolveCredentialAccessToken).toHaveBeenCalledWith(
      'resolved-credential-1',
      'owner-1',
      expect.any(String)
    )
    expect(mockAuthorizeCredentialUse.mock.invocationCallOrder[0]).toBeLessThan(
      mockResolveOAuthAccountId.mock.invocationCallOrder[0]
    )
    expect(mockResolveOAuthAccountId.mock.invocationCallOrder[0]).toBeLessThan(
      mockResolveCredentialAccessToken.mock.invocationCallOrder[0]
    )
    expect(mockResolveCredentialAccessToken.mock.invocationCallOrder[0]).toBeLessThan(
      mockFetch.mock.invocationCallOrder[0]
    )
  })

  it('fails closed on credential authorization before metadata, secrets, or egress', async () => {
    mockAuthorizeCredentialUse.mockResolvedValueOnce({ ok: false, error: 'Forbidden' })

    const response = await POST(request(REQUEST_BODY), {})

    expect(response.status).toBe(403)
    expect(mockResolveOAuthAccountId).not.toHaveBeenCalled()
    expect(mockResolveCredentialAccessToken).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    [
      'non-service-account authorization',
      () =>
        mockAuthorizeCredentialUse.mockResolvedValueOnce({
          ok: true,
          credentialOwnerUserId: 'owner-1',
          resolvedCredentialId: 'resolved-credential-1',
          credentialType: 'oauth',
        }),
    ],
    [
      'wrong service-account provider',
      () =>
        mockResolveOAuthAccountId.mockResolvedValueOnce({
          credentialType: 'service_account',
          providerId: 'snowflake-service-account',
        }),
    ],
    ['missing credential metadata', () => mockResolveOAuthAccountId.mockResolvedValueOnce(null)],
  ])('rejects a %s before secret resolution or provider egress', async (_label, arrange) => {
    arrange()

    const response = await POST(request(REQUEST_BODY), {})

    expect(response.status).toBe(400)
    expect(mockResolveCredentialAccessToken).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('uses only the fixed Harmonic origin and apikey header and returns no secret data', async () => {
    mockFetch.mockResolvedValueOnce(
      providerResponse([
        peopleSearch(2, 'Zeta search'),
        {
          id: 99,
          entity_urn: 'urn:harmonic:saved_search:99',
          name: 'Companies',
          type: 'COMPANIES',
        },
        peopleSearch(1, 'Alpha search'),
        peopleSearch(1, 'Alpha search'),
      ])
    )

    const response = await POST(request(REQUEST_BODY), {})
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.harmonic.ai/savedSearches',
      expect.objectContaining({ method: 'GET', redirect: 'error' })
    )
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).get('apikey')).toBe('server-only-api-key')
    expect(new Headers(init.headers).get('authorization')).toBeNull()
    expect(body).toEqual({
      savedSearches: [
        { id: '1', urn: 'urn:harmonic:saved_search:1', name: 'Alpha search' },
        { id: '2', urn: 'urn:harmonic:saved_search:2', name: 'Zeta search' },
      ],
    })
    expect(JSON.stringify(body)).not.toContain('server-only-api-key')
    expect(JSON.stringify(body)).not.toContain('confidential')
  })

  it('preserves a signed safe-integer ID without inventing an OpenAPI minimum', async () => {
    mockFetch.mockResolvedValueOnce(providerResponse([peopleSearch(-7, 'Signed ID search')]))

    const response = await POST(request(REQUEST_BODY), {})

    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      savedSearches: [
        {
          id: '-7',
          urn: 'urn:harmonic:saved_search:-7',
          name: 'Signed ID search',
        },
      ],
    })
  })

  it.each([
    [401, 401, true],
    [403, 401, true],
    [404, 400, undefined],
    [429, 429, undefined],
    [500, 502, undefined],
  ])(
    'maps provider status %s without reflecting provider details',
    async (status, expected, auth) => {
      mockFetch.mockResolvedValueOnce(providerResponse({ error: 'provider secret detail' }, status))

      const response = await POST(request(REQUEST_BODY), {})
      const body = await json(response)

      expect(response.status).toBe(expected)
      expect(body.authRequired).toBe(auth)
      expect(JSON.stringify(body)).not.toContain('provider secret detail')
    }
  )

  it.each([
    ['non-array root', { data: [] }],
    ['non-object row', [null]],
    ['missing required person identity', [{ type: 'PERSONS', name: 'Broken' }]],
    ['conflicting numeric identity', [peopleSearch(1), { ...peopleSearch(2), id: 1 }]],
    ['too many raw rows', Array.from({ length: 2_001 }, () => ({ type: 'COMPANIES' }))],
  ])('fails closed on a %s provider response', async (_label, providerBody) => {
    mockFetch.mockResolvedValueOnce(providerResponse(providerBody))

    const response = await POST(request(REQUEST_BODY), {})

    expect(response.status).toBe(502)
    expect(await json(response)).toEqual({
      error: 'Harmonic returned an invalid saved-search response.',
    })
  })

  it('rejects malformed and oversized provider bodies', async () => {
    mockFetch
      .mockResolvedValueOnce(providerResponse('{not-json'))
      .mockResolvedValueOnce(
        providerResponse('[]', 200, { 'content-length': String(1024 * 1024 + 1) })
      )

    for (let requestNumber = 0; requestNumber < 2; requestNumber++) {
      const response = await POST(request(REQUEST_BODY), {})
      expect(response.status).toBe(502)
      expect(mockResolveCredentialAccessToken).toHaveBeenCalledTimes(requestNumber + 1)
    }
  })

  it('accepts the exact people-option ceiling after filtering and deduplication', async () => {
    const searches = Array.from(
      { length: HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS },
      (_, index) => peopleSearch(index + 1)
    )
    searches.push(peopleSearch(1), {
      id: 9999,
      entity_urn: 'urn:harmonic:saved_search:9999',
      name: 'Company search',
      type: 'COMPANIES',
      query: { confidential: 'not returned' },
    })
    mockFetch.mockResolvedValueOnce(providerResponse(searches))

    const response = await POST(request(REQUEST_BODY), {})
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(body.savedSearches).toHaveLength(HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS)
  })

  it('truncates to the option ceiling instead of failing the whole selector', async () => {
    mockFetch.mockResolvedValueOnce(
      providerResponse(
        Array.from({ length: HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS + 25 }, (_, index) =>
          peopleSearch(index + 1)
        )
      )
    )

    const response = await POST(request(REQUEST_BODY), {})
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(body.savedSearches).toHaveLength(HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS)
  })

  it.each([
    [null, 401],
    [new TokenServiceAccountValidationError('invalid_credentials', 401), 401],
    [new TokenServiceAccountValidationError('provider_unavailable', 502), 502],
  ])(
    'keeps credential-resolution failure %s away from provider egress',
    async (failure, status) => {
      if (failure) mockResolveCredentialAccessToken.mockRejectedValueOnce(failure)
      else mockResolveCredentialAccessToken.mockResolvedValueOnce(null)

      const response = await POST(request(REQUEST_BODY), {})

      expect(response.status).toBe(status)
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it('keeps unexpected credential infrastructure errors generic', async () => {
    mockResolveCredentialAccessToken.mockRejectedValueOnce(
      new Error('secret credential infrastructure detail')
    )

    const response = await POST(request(REQUEST_BODY), {})
    const body = await json(response)

    expect(response.status).toBe(500)
    expect(body.error).toBe('Internal server error')
    expect(JSON.stringify(body)).not.toContain('secret credential infrastructure detail')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('maps provider network failures and timeouts without leaking the thrown message', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('network secret detail'))
      .mockRejectedValueOnce(new DOMException('timeout secret detail', 'TimeoutError'))

    const networkResponse = await POST(request(REQUEST_BODY), {})
    expect(networkResponse.status).toBe(502)
    expect(JSON.stringify(await json(networkResponse))).not.toContain('network secret detail')

    const timeoutResponse = await POST(request(REQUEST_BODY), {})
    expect(timeoutResponse.status).toBe(504)
    expect(JSON.stringify(await json(timeoutResponse))).not.toContain('timeout secret detail')
  })

  it('propagates client cancellation through provider egress', async () => {
    const controller = new AbortController()
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    })

    const pending = POST(request(REQUEST_BODY, controller.signal), {})
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    controller.abort(new Error('caller cancelled'))
    const response = await pending

    expect(response.status).toBe(499)
  })
})
