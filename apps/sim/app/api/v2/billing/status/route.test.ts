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

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/billing/application/get-billing-status', () => ({
  getBillingStatus: { operation: { id: 'billing.status.read' }, execute: mocks.execute },
}))

import {
  PersonalApiKeysDisabledError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
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
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue(result)
  })

  it('passes only the authenticated principal and requested scope to the use case', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/v2/billing/status?workspaceId=workspace-1'
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: result })
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workspaceId: 'workspace-1' },
      request,
    })
    expect(response.headers.get('x-ratelimit-limit')).toBe('100')
  })

  it('serializes a withheld payer pool as null without failing response validation', async () => {
    mocks.execute.mockResolvedValueOnce({ ...result, credits: null, storage: null })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/v2/billing/status?workspaceId=workspace-1')
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { ...result, credits: null, storage: null } })
  })

  it.each(['workspaceID', 'workspace_id', 'workspace'])(
    'rejects %s rather than silently answering for the account payer',
    async (key) => {
      const response = await GET(
        new NextRequest(`http://localhost:3000/api/v2/billing/status?${key}=workspace-1`)
      )

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } })
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )

  it('names the cause of an actionable workspace-policy refusal', async () => {
    mocks.execute.mockRejectedValueOnce(new PersonalApiKeysDisabledError())

    const response = await GET(
      new NextRequest('http://localhost:3000/api/v2/billing/status?workspaceId=workspace-1')
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'FORBIDDEN', details: { code: 'PERSONAL_API_KEYS_DISABLED' } },
    })
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

  it('hides unknown billing infrastructure errors', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('stripe account details'))

    const response = await GET(new NextRequest('http://localhost:3000/api/v2/billing/status'))

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
