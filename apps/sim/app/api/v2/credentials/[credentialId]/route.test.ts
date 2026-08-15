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

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)
vi.mock('@/lib/credentials/application/service-account', () => ({
  deleteCredentialUseCase: {
    operation: { id: 'credentials.delete' },
    execute: mocks.execute,
  },
}))

import { DELETE } from '@/app/api/v2/credentials/[credentialId]/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' },
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

describe('DELETE /api/v2/credentials/[credentialId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({ credential: { id: 'credential-1' } })
  })

  it('disconnects a credential through the application operation', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/credentials/credential-1?workspaceId=${WORKSPACE_ID}`,
      { method: 'DELETE' }
    )
    const response = await DELETE(request, {
      params: Promise.resolve({ credentialId: 'credential-1' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: 'credential-1', deleted: true } })
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workspaceId: WORKSPACE_ID, credentialId: 'credential-1' },
      request,
    })
  })

  it('requires the asserted workspace scope', async () => {
    const response = await DELETE(
      new NextRequest('http://localhost:3000/api/v2/credentials/credential-1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ credentialId: 'credential-1' }) }
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
