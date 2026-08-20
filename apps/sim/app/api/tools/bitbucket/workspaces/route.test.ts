/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorizeCredentialUse,
  mockCheckSessionOrInternalAuth,
  mockFetch,
  mockGetCredential,
  mockRefreshAccessTokenIfNeeded,
} = vi.hoisted(() => ({
  mockAuthorizeCredentialUse: vi.fn(),
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockFetch: vi.fn(),
  mockGetCredential: vi.fn(),
  mockRefreshAccessTokenIfNeeded: vi.fn(),
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mockAuthorizeCredentialUse,
}))
vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))
vi.mock('@/lib/oauth/credential-service', () => ({
  getCredential: mockGetCredential,
  refreshAccessTokenIfNeeded: mockRefreshAccessTokenIfNeeded,
}))

import { POST } from '@/app/api/tools/bitbucket/workspaces/route'

const URL = 'http://localhost:3000/api/tools/bitbucket/workspaces'
const FIRST_PAGE_URL =
  'https://api.bitbucket.org/2.0/user/workspaces?pagelen=100&fields=values.administrator%2Cvalues.workspace.slug%2Cvalues.workspace.uuid%2Cvalues.workspace.name%2Cnext'
const SECOND_PAGE_URL = 'https://api.bitbucket.org/2.0/user/workspaces?page=2&pagelen=100'
const REQUEST_BODY = { credential: 'credential-1', workflowId: 'workflow-1' } as const

function request(body: unknown): NextRequest {
  return new NextRequest(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function providerResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

describe('POST /api/tools/bitbucket/workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'caller-1' })
    mockAuthorizeCredentialUse.mockResolvedValue({
      ok: true,
      credentialOwnerUserId: 'owner-1',
      resolvedCredentialId: 'account-1',
      credentialType: 'oauth',
    })
    mockGetCredential.mockResolvedValue({ providerId: 'bitbucket' })
    mockRefreshAccessTokenIfNeeded.mockResolvedValue('server-only-token')
    mockFetch.mockResolvedValue(providerResponse({ values: [] }))
  })

  afterAll(() => vi.unstubAllGlobals())

  it('authenticates before attempting to parse an invalid body', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
    })

    const response = await POST(request('{not-json'), {})

    expect(response.status).toBe(401)
    expect(mockCheckSessionOrInternalAuth).toHaveBeenCalledWith(expect.any(NextRequest), {
      requireWorkflowId: true,
    })
    expect(mockAuthorizeCredentialUse).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('authorizes the exact credential before resolving or refreshing it', async () => {
    const response = await POST(request(REQUEST_BODY), {})

    expect(response.status).toBe(200)
    expect(mockAuthorizeCredentialUse).toHaveBeenCalledWith(expect.any(NextRequest), {
      credentialId: 'credential-1',
      workflowId: 'workflow-1',
      callerUserId: 'caller-1',
    })
    expect(mockGetCredential).toHaveBeenCalledWith(expect.any(String), 'account-1', 'owner-1')
    expect(mockRefreshAccessTokenIfNeeded).toHaveBeenCalledWith(
      'account-1',
      'owner-1',
      expect.any(String)
    )
  })

  it('fails closed when credential authorization is denied', async () => {
    mockAuthorizeCredentialUse.mockResolvedValueOnce({ ok: false, error: 'Forbidden' })

    const response = await POST(request(REQUEST_BODY), {})

    expect(response.status).toBe(403)
    expect(await json(response)).toMatchObject({ error: 'Forbidden' })
    expect(mockGetCredential).not.toHaveBeenCalled()
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not send a credential for another provider to Bitbucket', async () => {
    mockGetCredential.mockResolvedValueOnce({ providerId: 'github' })

    const response = await POST(request(REQUEST_BODY), {})

    expect(response.status).toBe(400)
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns an auth-required response when token refresh cannot resolve a token', async () => {
    mockRefreshAccessTokenIfNeeded.mockResolvedValueOnce(null)

    const response = await POST(request(REQUEST_BODY), {})

    expect(response.status).toBe(401)
    expect(await json(response)).toMatchObject({ authRequired: true })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['plain HTTP', 'http://api.bitbucket.org/2.0/user/workspaces?page=2'],
    ['lookalike host', 'https://api.bitbucket.org.evil.example/2.0/user/workspaces?page=2'],
    ['non-default port', 'https://api.bitbucket.org:444/2.0/user/workspaces?page=2'],
    ['wrong v2 endpoint', 'https://api.bitbucket.org/2.0/repositories/acme?page=2'],
    ['embedded credentials', 'https://attacker:secret@api.bitbucket.org/2.0/user/workspaces'],
  ])('rejects a %s cursor before resolving a bearer token', async (_label, cursor) => {
    const response = await POST(request({ ...REQUEST_BODY, cursor }), {})

    expect(response.status).toBe(400)
    expect(mockAuthorizeCredentialUse).not.toHaveBeenCalled()
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('normalizes a page and returns only the provider cursor, never the bearer token', async () => {
    mockFetch.mockResolvedValueOnce(
      providerResponse({
        values: [
          {
            administrator: true,
            workspace: {
              slug: 'acme-platform',
              uuid: '{workspace-uuid}',
              name: 'Acme Platform',
              links: { html: { href: 'https://bitbucket.org/acme-platform' } },
            },
          },
        ],
        next: SECOND_PAGE_URL,
      })
    )

    const response = await POST(request(REQUEST_BODY), {})
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(
      FIRST_PAGE_URL,
      expect.objectContaining({ method: 'GET', redirect: 'error' })
    )
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer server-only-token')
    expect(body).toEqual({
      workspaces: [
        {
          slug: 'acme-platform',
          uuid: '{workspace-uuid}',
          name: 'Acme Platform',
          administrator: true,
        },
      ],
      nextCursor: SECOND_PAGE_URL,
    })
    expect(JSON.stringify(body)).not.toContain('server-only-token')
  })

  it('uses a validated provider cursor for exactly one progressive page', async () => {
    const response = await POST(request({ ...REQUEST_BODY, cursor: SECOND_PAGE_URL }), {})

    expect(response.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(SECOND_PAGE_URL, expect.any(Object))
  })

  it('uses the slug when the current workspace-access shape omits a display name', async () => {
    mockFetch.mockResolvedValueOnce(
      providerResponse({
        values: [
          {
            administrator: false,
            workspace: { slug: 'acme-platform', uuid: '{workspace-uuid}' },
          },
        ],
      })
    )

    const response = await POST(request(REQUEST_BODY), {})

    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      workspaces: [
        {
          slug: 'acme-platform',
          uuid: '{workspace-uuid}',
          name: 'acme-platform',
          administrator: false,
        },
      ],
    })
  })

  it.each([
    ['missing values', {}],
    ['non-array values', { values: 'not-an-array' }],
    ['malformed workspace', { values: [{ workspace: { slug: 'acme', uuid: 42, name: 'Acme' } }] }],
    [
      'oversized page',
      {
        values: Array.from({ length: 101 }, (_, index) => ({
          workspace: {
            slug: `workspace-${index}`,
            uuid: `{workspace-${index}}`,
            name: `Workspace ${index}`,
          },
        })),
      },
    ],
  ])('fails closed on a %s provider response', async (_label, providerBody) => {
    mockFetch.mockResolvedValueOnce(providerResponse(providerBody))

    const response = await POST(request(REQUEST_BODY), {})

    expect(response.status).toBe(502)
    expect(await json(response)).toEqual({
      error: 'Bitbucket returned an invalid workspace response.',
    })
  })

  it('fails closed on invalid provider JSON', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{not-json', { status: 200 }))

    const response = await POST(request(REQUEST_BODY), {})

    expect(response.status).toBe(502)
  })

  it('rejects a provider next link that could redirect the bearer token elsewhere', async () => {
    mockFetch.mockResolvedValueOnce(
      providerResponse({
        values: [],
        next: 'https://evil.example/2.0/user/workspaces?page=2',
      })
    )

    const response = await POST(request(REQUEST_BODY), {})

    expect(response.status).toBe(502)
    expect(await json(response)).toEqual({
      error: 'Bitbucket returned an invalid workspace response.',
    })
  })
})
