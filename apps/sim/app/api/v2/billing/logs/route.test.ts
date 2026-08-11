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

vi.mock('@/lib/billing/application/list-billing-logs', () => ({
  listBillingLogs: { operation: { id: 'billing.logs.list' }, execute: mocks.execute },
}))

import { GET } from '@/app/api/v2/billing/logs/route'

const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' },
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

describe('GET /api/v2/billing/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'))
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({
      usage: {
        logs: [
          {
            id: 'log-1',
            createdAt: '2026-07-01T00:00:00.000Z',
            source: 'workflow',
            cost: 0.06,
            workspaceId: 'workspace-1',
            workflowId: 'workflow-1',
            workflowName: 'Support Agent',
            executionId: 'run-1',
          },
        ],
        summary: { totalCost: 0, bySource: {} },
        pagination: { hasMore: false },
      },
      creditsByLogId: { 'log-1': 12 },
    })
  })

  it('maps billing filters and preserves the public ledger envelope', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/v2/billing/logs?workspaceId=workspace-1&source=sim-chat'
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          id: 'log-1',
          createdAt: '2026-07-01T00:00:00.000Z',
          source: 'workflow',
          workspaceId: 'workspace-1',
          workflow: { id: 'workflow-1', name: 'Support Agent' },
          runId: 'run-1',
          creditCost: 12,
        },
      ],
      nextCursor: null,
    })
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: expect.objectContaining({
        workspaceId: 'workspace-1',
        source: ['copilot', 'workspace-chat'],
      }),
      request,
    })
  })

  it('authenticates before rejecting invalid custom ranges', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/v2/billing/logs?period=custom')
    )

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
