/**
 * @vitest-environment node
 */

import { loggingSessionMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceBilledAccountUserId } = vi.hoisted(() => ({
  mockGetWorkspaceBilledAccountUserId: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkServerSideUsageLimits: vi.fn(),
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: vi.fn(),
}))
vi.mock('@/lib/core/execution-limits', () => ({
  getExecutionTimeout: vi.fn(() => 0),
}))
vi.mock('@/lib/core/rate-limiter/rate-limiter', () => ({
  RateLimiter: vi.fn(),
}))
vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)
vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBilledAccountUserId: mockGetWorkspaceBilledAccountUserId,
}))

vi.mock('@sim/workflow-authz', () => ({
  getActiveWorkflowRecord: vi.fn().mockResolvedValue({
    id: 'workflow-1',
    workspaceId: 'workspace-1',
    isDeployed: true,
  }),
}))

import { preprocessExecution } from './preprocessing'

describe('preprocessExecution webhook correlation logging', () => {
  it('preserves webhook correlation when logging preprocessing failures', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValueOnce(null)

    const loggingSession = {
      safeStart: vi.fn().mockResolvedValue(true),
      safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
    }

    const correlation = {
      executionId: 'execution-webhook-1',
      requestId: 'request-webhook-1',
      source: 'webhook' as const,
      workflowId: 'workflow-1',
      webhookId: 'webhook-1',
      path: 'incoming/slack',
      provider: 'slack',
      triggerType: 'webhook',
    }

    const result = await preprocessExecution({
      workflowId: 'workflow-1',
      userId: 'unknown',
      triggerType: 'webhook',
      executionId: 'execution-webhook-1',
      requestId: 'request-webhook-1',
      loggingSession: loggingSession as any,
      triggerData: { correlation },
      workflowRecord: {
        id: 'workflow-1',
        workspaceId: 'workspace-1',
        isDeployed: true,
      } as any,
    })

    expect(result).toMatchObject({
      success: false,
      error: {
        statusCode: 500,
        logCreated: true,
      },
    })

    expect(loggingSession.safeStart).toHaveBeenCalledWith({
      userId: 'unknown',
      workspaceId: 'workspace-1',
      variables: {},
      triggerData: { correlation },
    })
  })
})
