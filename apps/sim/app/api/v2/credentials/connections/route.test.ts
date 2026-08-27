/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/credentials/application/create-credential-connection', () => ({
  createCredentialConnection: {
    operation: { id: 'credentials.connections.create' },
    execute: mocks.execute,
  },
}))

import { POST } from '@/app/api/v2/credentials/connections/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

describe('POST /api/v2/credentials/connections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({
      authorizationUrl: 'https://sim.ai/api/auth/oauth2/authorize?draftId=draft-1',
      expiresAt: new Date('2026-08-12T20:15:00.000Z'),
    })
  })

  it('creates a browser entrypoint for a named OAuth credential', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/credentials/connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        providerId: 'google-email',
        displayName: 'Work Gmail',
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        authorizationUrl: 'https://sim.ai/api/auth/oauth2/authorize?draftId=draft-1',
        expiresAt: '2026-08-12T20:15:00.000Z',
      },
    })
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        workspaceId: WORKSPACE_ID,
        providerId: 'google-email',
        displayName: 'Work Gmail',
      },
      request,
    })
  })

  it('requires a display name for new OAuth connections', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credentials/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID, providerId: 'google-email' }),
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
