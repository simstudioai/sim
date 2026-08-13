/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceApiKeyScopeAuthorizationError } from '@/lib/core/application'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)
vi.mock('@/lib/credentials/application/create-credential-connection', () => ({
  createCredentialConnection: {
    operation: { id: 'credentials.connections.create' },
    execute: mocks.execute,
  },
}))

import { POST } from '@/app/api/v2/credential-connections/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' },
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

describe('POST /api/v2/credential-connections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({
      authorizationUrl: 'https://sim.ai/api/auth/oauth2/authorize?draftId=draft-1',
      expiresAt: new Date('2026-08-12T20:15:00.000Z'),
    })
  })

  it('rejects requests that provide both connection targets', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credential-connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          providerId: 'google-email',
          displayName: 'Work Gmail',
          credentialId: 'credential-1',
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('requires a display name for a new connection', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credential-connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID, providerId: 'google-email' }),
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects a display name when reconnecting an existing credential', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credential-connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          credentialId: 'credential-1',
          displayName: 'Renamed Gmail',
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('returns the short-lived browser URL', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/credential-connections', {
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
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        workspaceId: WORKSPACE_ID,
        providerId: 'google-email',
        displayName: 'Work Gmail',
      },
      request,
    })
    expect(await response.json()).toEqual({
      data: {
        authorizationUrl: 'https://sim.ai/api/auth/oauth2/authorize?draftId=draft-1',
        expiresAt: '2026-08-12T20:15:00.000Z',
      },
    })
  })

  it('conceals inaccessible workspaces as not found', async () => {
    mocks.execute.mockRejectedValueOnce(new WorkspaceApiKeyScopeAuthorizationError())

    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credential-connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          providerId: 'google-email',
          displayName: 'Work Gmail',
        }),
      })
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Workspace not found' },
    })
  })
})
