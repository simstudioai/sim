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
vi.mock('@/lib/credentials/application/list-credential-providers', () => ({
  listCredentialProviders: {
    operation: { id: 'credentials.providers.list' },
    execute: mocks.execute,
  },
}))

import { GET } from '@/app/api/v2/credential-providers/route'

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

describe('GET /api/v2/credential-providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({
      providers: [
        {
          serviceId: 'salesforce',
          name: 'Salesforce',
          description: 'Connect Salesforce.',
          providerFamily: 'salesforce',
          available: true,
          supportsReconnect: true,
          authorizationOptions: [
            { providerId: 'salesforce', label: 'Production' },
            { providerId: 'salesforce-sandbox', label: 'Sandbox' },
          ],
        },
      ],
    })
  })

  it('returns the full provider catalog in one page', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/credential-providers?workspaceId=${WORKSPACE_ID}`
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workspaceId: WORKSPACE_ID },
      request,
    })
    expect(await response.json()).toEqual({
      data: [
        {
          serviceId: 'salesforce',
          name: 'Salesforce',
          description: 'Connect Salesforce.',
          providerFamily: 'salesforce',
          available: true,
          supportsReconnect: true,
          authorizationOptions: [
            { providerId: 'salesforce', label: 'Production' },
            { providerId: 'salesforce-sandbox', label: 'Sandbox' },
          ],
        },
      ],
      nextCursor: null,
    })
  })

  it('rejects query parameters it does not implement', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/credential-providers?workspaceId=${WORKSPACE_ID}&limit=1`
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('conceals a workspace-key scope mismatch as not found', async () => {
    mocks.execute.mockRejectedValueOnce(new WorkspaceApiKeyScopeAuthorizationError())

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/credential-providers?workspaceId=${WORKSPACE_ID}`
      )
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Workspace not found' },
    })
  })
})
