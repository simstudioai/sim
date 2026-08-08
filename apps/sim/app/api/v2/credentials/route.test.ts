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

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/credentials/application/list-workspace-credentials', () => ({
  listWorkspaceCredentials: {
    operation: { id: 'credentials.connections.list' },
    execute: mocks.execute,
  },
}))

import { GET } from '@/app/api/v2/credentials/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const credential = {
  id: 'credential-1',
  workspaceId: WORKSPACE_ID,
  type: 'service_account' as const,
  displayName: 'Zoom account',
  description: null,
  providerId: 'zoom-service-account',
  accountId: null,
  envKey: 'MUST_NOT_LEAK',
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  hasServiceAccountKey: true,
  role: 'member' as const,
}

describe('GET /api/v2/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({ credentials: [credential] })
  })

  it('authenticates and charges before validating workspace input', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/v2/credentials'))

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalled()
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('calls the application operation with the workspace principal', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}&type=service_account`
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        providerId: undefined,
        search: undefined,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      },
      request,
    })
  })

  it('projects credential metadata field by field without secret material', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}`)
    )
    const body = await response.json()

    expect(body).toEqual({
      data: [
        {
          id: 'credential-1',
          type: 'service_account',
          displayName: 'Zoom account',
          description: null,
          providerId: 'zoom-service-account',
          accountId: null,
          hasServiceAccountKey: true,
          role: 'member',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(JSON.stringify(body)).not.toContain('envKey')
    expect(JSON.stringify(body)).not.toContain('createdBy')
  })

  it('hides repository errors that may contain secret details', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('encryptedServiceAccountKey failed'))

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
