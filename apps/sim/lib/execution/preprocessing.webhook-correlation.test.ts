/**
 * @vitest-environment node
 */

import { loggingSessionMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

const { mockResolveSystemBillingAttribution } = vi.hoisted(() => ({
  mockResolveSystemBillingAttribution: vi.fn(),
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkServerSideUsageLimits: vi.fn(),
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: vi.fn((value) => value),
  checkAttributedUsageLimits: vi.fn(),
  resolveBillingAttribution: vi.fn(),
  resolveSystemBillingAttribution: mockResolveSystemBillingAttribution,
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

vi.mock('@sim/platform-authz/workflow', () => ({
  getActiveWorkflowRecord: vi.fn().mockResolvedValue({
    id: 'workflow-1',
    workspaceId: 'workspace-1',
    isDeployed: true,
  }),
}))

import { preprocessExecution } from './preprocessing'

describe('preprocessExecution webhook correlation logging', () => {
  it('preserves webhook correlation when logging preprocessing failures', async () => {
    mockResolveSystemBillingAttribution.mockRejectedValueOnce(
      new Error('Unable to resolve billing payer')
    )

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
