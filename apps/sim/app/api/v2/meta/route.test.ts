/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/api/application/read-v2-api-capabilities', () => ({
  readV2ApiCapabilities: {
    operation: { id: 'meta.capabilities.read' },
    execute: mocks.read,
  },
}))

import { GET } from '@/app/api/v2/meta/route'

const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
  keyExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
}

function request(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v2/meta${query}`, {
    headers: { 'x-api-key': 'secret' },
  })
}

describe('GET /api/v2/meta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.read.mockResolvedValue({
      v2Enabled: true,
      keyType: 'personal',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    })
  })

  it('returns the caller capabilities in the v2 envelope', async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({
      data: {
        v2Enabled: true,
        keyType: 'personal',
        expiresAt: '2027-01-01T00:00:00.000Z',
      },
    })
  })

  it('reports a key with no expiry as null', async () => {
    mocks.read.mockResolvedValue({ v2Enabled: true, keyType: 'workspace', expiresAt: null })

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({
      data: { v2Enabled: true, keyType: 'workspace', expiresAt: null },
    })
  })

  it('requires authentication', async () => {
    v2RouteMocks.authenticate.mockRejectedValue(
      new MockV2ApiKeyUnauthenticatedError('API key or OAuth access token required')
    )

    const response = await GET(new NextRequest('http://localhost:3000/api/v2/meta'))

    expect(response.status).toBe(401)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('rejects an undeclared query parameter', async () => {
    const response = await GET(request('?foo=1'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'BAD_REQUEST' } })
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('passes the credential facts the authenticator resolved, not a re-read', async () => {
    const authenticated = request()
    await GET(authenticated)

    expect(mocks.read).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        keyType: 'personal',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
      request: authenticated,
    })
  })
})
