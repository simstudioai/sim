import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
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

vi.mock('@/lib/billing/application/get-billing-status', () => ({
  getBillingStatus: { operation: { id: 'billing.status.read' }, execute: mocks.execute },
}))

import { WorkspaceApiKeyScopeAuthorizationError } from '@/lib/core/application'
import { GET } from '@/app/api/v2/billing/status/route'

const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: 'workspace-1', keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', 'workspace:workspace-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const result = {
  workspaceId: 'workspace-1',
  period: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
  plan: 'team',
  status: 'active' as const,
  credits: { used: 500, limit: 20_000, remaining: 19_500 },
  storage: { usedBytes: 5_242_880, limitBytes: 1_073_741_824, percentUsed: 0.48828125 },
}

describe('GET /api/v2/billing/status', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue(result)
  })

  /**
   * A workspace key naming another workspace must not learn that the workspace
   * exists, so this refusal is answered exactly as an unknown workspace id is.
   */
  it('conceals a cross-tenant workspace-key refusal as a not-found workspace', async () => {
    mocks.execute.mockRejectedValueOnce(new WorkspaceApiKeyScopeAuthorizationError())

    const response = await GET(
      new NextRequest('http://localhost:3000/api/v2/billing/status?workspaceId=workspace-2')
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Workspace not found' },
    })
  })
})
