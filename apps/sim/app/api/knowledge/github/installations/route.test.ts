/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), connect: vi.fn(), rateLimit: vi.fn() }))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceUserRateLimit: mocks.rateLimit,
  RateLimiter: class {},
}))
vi.mock('@/lib/knowledge/application/github-installations', () => ({
  listGitHubSearchInstallations: {
    operation: { id: 'knowledge.github.installations.list' },
    execute: mocks.list,
  },
  connectGitHubSearchInstallation: {
    operation: { id: 'knowledge.github.installations.connect' },
    execute: mocks.connect,
  },
}))
vi.mock('@/lib/oauth/github-installation', () => ({
  GitHubInstallationError: class extends Error {
    constructor(
      message: string,
      readonly status?: number
    ) {
      super(message)
    }
  },
}))
vi.mock('@/lib/credentials/managed-oauth', () => ({
  ManagedOAuthCredentialError: class extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly statusCode: number
    ) {
      super(message)
    }
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { ManagedOAuthCredentialError } from '@/lib/credentials/managed-oauth'
import { GitHubInstallationError } from '@/lib/oauth/github-installation'
import { GET, POST } from '@/app/api/knowledge/github/installations/route'

const URL = 'http://localhost/api/knowledge/github/installations'
const installation = {
  installationId: '123',
  accountId: '456',
  accountLogin: 'acme',
  accountType: 'Organization',
}

beforeEach(() => {
  vi.clearAllMocks()
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'admin-1' },
    session: { id: 'session-1' },
  })
  mocks.rateLimit.mockResolvedValue(null)
  mocks.list.mockResolvedValue({
    available: true,
    installUrl: 'https://github.com/apps/sim-search/installations/new',
    needsUserConnection: false,
    installations: [installation],
  })
  mocks.connect.mockResolvedValue({ credential: { id: 'cred-1', displayName: 'GitHub · acme' } })
})

describe('GitHub installation route boundary', () => {
  it.each(['GET', 'POST'] as const)(
    'authenticates %s before parsing or calling the use case',
    async (method) => {
      authMockFns.mockGetSession.mockResolvedValue(null)
      const request = new NextRequest(URL, method === 'POST' ? { method, body: '{' } : undefined)
      const json = vi.spyOn(request, 'json')
      const response = await (method === 'GET' ? GET(request) : POST(request))
      expect(response.status).toBe(401)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(json).not.toHaveBeenCalled()
      expect(mocks.rateLimit).not.toHaveBeenCalled()
      expect(mocks.list).not.toHaveBeenCalled()
      expect(mocks.connect).not.toHaveBeenCalled()
    }
  )

  it('applies admission before parsing the POST body', async () => {
    mocks.rateLimit.mockResolvedValue(
      NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    )
    const request = new NextRequest(URL, { method: 'POST', body: '{' })
    const json = vi.spyOn(request, 'json')
    expect((await POST(request)).status).toBe(429)
    expect(json).not.toHaveBeenCalled()
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      'github-search-installations',
      'admin-1',
      undefined
    )
  })

  it.each(['0', '-1', '1.5', '123/path', ''])(
    'rejects invalid installation ID %s before the use case',
    async (installationId) => {
      const response = await POST(
        new NextRequest(URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId: 'org-1', installationId }),
        })
      )
      expect(response.status).toBe(400)
      expect(mocks.connect).not.toHaveBeenCalled()
    }
  )

  it('requires organization scope for GET', async () => {
    expect((await GET(new NextRequest(URL))).status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('forwards GET identity and cancellation and projects a private installation list', async () => {
    const controller = new AbortController()
    const request = new NextRequest(`${URL}?organizationId=org-1`, { signal: controller.signal })
    mocks.list.mockResolvedValue({
      available: true,
      installUrl: 'https://github.com/apps/sim-search/installations/new',
      needsUserConnection: false,
      installations: [{ ...installation, accessToken: 'private' }],
      privateKey: 'private',
    })
    const response = await GET(request)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'admin-1', sessionId: 'session-1' },
        input: { organizationId: 'org-1', signal: request.signal },
      })
    )
    expect(await response.json()).toEqual({
      success: true,
      available: true,
      installUrl: 'https://github.com/apps/sim-search/installations/new',
      needsUserConnection: false,
      installations: [installation],
    })
  })

  it('forwards POST cancellation and only returns the safe credential projection', async () => {
    const request = new NextRequest(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: 'org-1', installationId: '123' }),
    })
    mocks.connect.mockResolvedValue({
      credential: {
        id: 'cred-1',
        displayName: 'GitHub · acme',
        encryptedServiceAccountKey: 'private',
      },
      created: true,
    })
    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { organizationId: 'org-1', installationId: '123', signal: request.signal },
      })
    )
    expect(await response.json()).toEqual({
      success: true,
      credential: { id: 'cred-1', displayName: 'GitHub · acme' },
    })
  })

  it.each([
    [
      new OrchestrationError('forbidden', 'Organization administrator access is required'),
      403,
      'Organization administrator access is required',
    ],
    [
      new GitHubInstallationError('Installation permission denied', 403),
      403,
      'Installation permission denied',
    ],
    [
      new GitHubInstallationError('GitHub is temporarily unavailable', 503),
      502,
      'GitHub is temporarily unavailable',
    ],
    [
      new ManagedOAuthCredentialError(
        'MANAGED_CREDENTIAL_NEEDS_REAUTH',
        'private refresh details',
        401
      ),
      401,
      'Reconnect your GitHub account to continue installation setup',
    ],
    [new Error('private database details'), 500, 'Internal server error'],
  ] as const)(
    'projects %s without successful installation data',
    async (error, status, message) => {
      mocks.list.mockRejectedValue(error)
      const response = await GET(new NextRequest(`${URL}?organizationId=org-1`))
      expect(response.status).toBe(status)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      const body = await response.json()
      expect(body.error).toBe(message)
      expect(body).not.toHaveProperty('installations')
      expect(body).not.toHaveProperty('credential')
    }
  )
})
