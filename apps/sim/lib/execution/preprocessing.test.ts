/**
 * @vitest-environment node
 */

import { loggingSessionMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceBilledAccountUserId, mockCheckRateLimit } = vi.hoisted(() => ({
  mockGetWorkspaceBilledAccountUserId: vi.fn(),
  mockCheckRateLimit: vi.fn(),
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
  RateLimiter: vi.fn(() => ({ checkRateLimitWithSubscription: mockCheckRateLimit })),
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

import { checkServerSideUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { preprocessExecution } from './preprocessing'

describe('preprocessExecution correlation logging', () => {
  it('preserves trigger correlation when logging preprocessing failures', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValueOnce(null)

    const loggingSession = {
      safeStart: vi.fn().mockResolvedValue(true),
      safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
    }

    const correlation = {
      executionId: 'execution-1',
      requestId: 'request-1',
      source: 'schedule' as const,
      workflowId: 'workflow-1',
      scheduleId: 'schedule-1',
      triggerType: 'schedule',
      scheduledFor: '2025-01-01T00:00:00.000Z',
    }

    const result = await preprocessExecution({
      workflowId: 'workflow-1',
      userId: 'unknown',
      triggerType: 'schedule',
      executionId: 'execution-1',
      requestId: 'request-1',
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

describe('preprocessExecution logPreprocessingErrors option', () => {
  const baseOptions = {
    workflowId: 'workflow-1',
    userId: 'owner-1',
    triggerType: 'workflow' as const,
    executionId: 'execution-1',
    requestId: 'request-1',
    checkDeployment: false,
    checkRateLimit: true,
    workflowRecord: { id: 'workflow-1', workspaceId: 'workspace-1', isDeployed: false } as any,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('billed-account-1')
    vi.mocked(getHighestPrioritySubscription).mockResolvedValue({ plan: 'free' } as any)
    vi.mocked(checkServerSideUsageLimits).mockResolvedValue({
      isExceeded: false,
      currentUsage: 1,
      limit: 10,
    } as any)
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 100,
      resetAt: new Date(),
    })
  })

  it('suppresses preprocessing-error logging when logPreprocessingErrors is false', async () => {
    vi.mocked(checkServerSideUsageLimits).mockResolvedValueOnce({
      isExceeded: true,
      currentUsage: 20,
      limit: 10,
      message: 'Usage limit exceeded. Please upgrade your plan to continue.',
    } as any)

    const loggingSession = {
      safeStart: vi.fn().mockResolvedValue(true),
      safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
    }

    const result = await preprocessExecution({
      ...baseOptions,
      logPreprocessingErrors: false,
      loggingSession: loggingSession as any,
    })

    expect(result).toMatchObject({ success: false, error: { statusCode: 402 } })
    // No execution-log row written — the caller (table cell) surfaces it instead.
    expect(loggingSession.safeStart).not.toHaveBeenCalled()
  })
})
