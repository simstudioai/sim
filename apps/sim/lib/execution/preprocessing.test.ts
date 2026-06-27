/**
 * @vitest-environment node
 */

import { loggingSessionMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceBilledAccountUserId, mockCheckRateLimit, mockGetActivelyBannedUserIds } =
  vi.hoisted(() => ({
    mockGetWorkspaceBilledAccountUserId: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockGetActivelyBannedUserIds: vi.fn().mockResolvedValue([]),
  }))

vi.mock('@sim/db', () => ({ db: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@/lib/auth/ban', () => ({
  getActivelyBannedUserIds: mockGetActivelyBannedUserIds,
}))
vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkServerSideUsageLimits: vi.fn(),
  checkOrgMemberUsageLimit: vi.fn().mockResolvedValue({ isExceeded: false }),
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: vi.fn(),
}))
vi.mock('@/lib/core/execution-limits', () => ({
  getExecutionTimeout: vi.fn(() => 0),
}))
vi.mock('@/lib/core/rate-limiter/rate-limiter', () => ({
  // Regular function (not an arrow) so `new RateLimiter()` is constructable under
  // vitest 4.x, which rejects `new` on an arrow-implemented mock.
  RateLimiter: vi.fn(function (this: unknown) {
    return { checkRateLimitWithSubscription: mockCheckRateLimit }
  }),
}))
vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)
vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBilledAccountUserId: mockGetWorkspaceBilledAccountUserId,
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  getActiveWorkflowRecord: vi.fn().mockResolvedValue({
    id: 'workflow-1',
    userId: 'creator-1',
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

describe('preprocessExecution ban gate', () => {
  const baseOptions = {
    workflowId: 'workflow-1',
    userId: 'owner-1',
    triggerType: 'workflow' as const,
    executionId: 'execution-1',
    requestId: 'request-1',
    checkDeployment: false,
    checkRateLimit: false,
    workflowRecord: { id: 'workflow-1', workspaceId: 'workspace-1', isDeployed: true } as any,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('billed-account-1')
    mockGetActivelyBannedUserIds.mockResolvedValue([])
    vi.mocked(getHighestPrioritySubscription).mockResolvedValue({ plan: 'free' } as any)
    vi.mocked(checkServerSideUsageLimits).mockResolvedValue({
      isExceeded: false,
      currentUsage: 1,
      limit: 10,
    } as any)
  })

  it('blocks execution with 403 when the actor is banned (ban wins over the parallel gates)', async () => {
    mockGetActivelyBannedUserIds.mockResolvedValue(['billed-account-1'])

    const loggingSession = {
      safeStart: vi.fn().mockResolvedValue(true),
      safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
    }

    const result = await preprocessExecution({
      ...baseOptions,
      loggingSession: loggingSession as any,
    })

    expect(result).toMatchObject({
      success: false,
      error: { statusCode: 403, logCreated: true, message: 'Account suspended' },
    })
    expect(loggingSession.safeStart).toHaveBeenCalled()
  })

  it('returns 403 (ban precedence) when ban, usage, and rate limit all fail simultaneously', async () => {
    mockGetActivelyBannedUserIds.mockResolvedValue(['billed-account-1'])
    vi.mocked(checkServerSideUsageLimits).mockResolvedValue({
      isExceeded: true,
      currentUsage: 20,
      limit: 10,
      message: 'Usage limit exceeded. Please upgrade your plan to continue.',
    } as any)
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(),
    })

    const loggingSession = {
      safeStart: vi.fn().mockResolvedValue(true),
      safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
    }

    const result = await preprocessExecution({
      ...baseOptions,
      checkRateLimit: true,
      loggingSession: loggingSession as any,
    })

    // Ban (403) takes precedence over usage (402) and rate limit (429),
    // independent of which parallel gate's promise settled first.
    expect(result).toMatchObject({
      success: false,
      error: { statusCode: 403, logCreated: true, message: 'Account suspended' },
    })
  })

  it('does not debit rate-limit quota when the ban gate rejects', async () => {
    // The rate-limit gate consumes a token, so it must not run for a request
    // an earlier gate (ban) already rejects.
    mockGetActivelyBannedUserIds.mockResolvedValue(['billed-account-1'])

    const result = await preprocessExecution({ ...baseOptions, checkRateLimit: true })

    expect(result).toMatchObject({ success: false, error: { statusCode: 403 } })
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('does not debit rate-limit quota when the usage gate rejects', async () => {
    vi.mocked(checkServerSideUsageLimits).mockResolvedValue({
      isExceeded: true,
      currentUsage: 20,
      limit: 10,
      message: 'Usage limit exceeded. Please upgrade your plan to continue.',
    } as any)

    const result = await preprocessExecution({ ...baseOptions, checkRateLimit: true })

    expect(result).toMatchObject({ success: false, error: { statusCode: 402 } })
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('consumes the rate-limit gate exactly once when the ban and usage gates pass', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 5, resetAt: new Date() })

    // skipConcurrencyReservation bypasses the STEP 7 admission reservation so the
    // assertion isolates the rate gate and does not depend on Redis availability.
    const result = await preprocessExecution({
      ...baseOptions,
      checkRateLimit: true,
      skipConcurrencyReservation: true,
    })

    expect(result.success).toBe(true)
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1)
  })

  it('checks the billing actor, caller-provided userId, and workflow owner in one call', async () => {
    const result = await preprocessExecution(baseOptions)

    expect(result.success).toBe(true)
    expect(mockGetActivelyBannedUserIds).toHaveBeenCalledTimes(1)
    expect(mockGetActivelyBannedUserIds).toHaveBeenCalledWith([
      'billed-account-1',
      'owner-1',
      'creator-1',
    ])
  })

  it('excludes the "unknown" sentinel userId but still checks the workflow owner', async () => {
    const result = await preprocessExecution({ ...baseOptions, userId: 'unknown' })

    expect(result.success).toBe(true)
    expect(mockGetActivelyBannedUserIds).toHaveBeenCalledWith(['billed-account-1', 'creator-1'])
  })

  it('fails closed with 500 when the ban check errors', async () => {
    mockGetActivelyBannedUserIds.mockRejectedValue(new Error('db down'))

    const loggingSession = {
      safeStart: vi.fn().mockResolvedValue(true),
      safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
    }

    const result = await preprocessExecution({
      ...baseOptions,
      loggingSession: loggingSession as any,
    })

    expect(result).toMatchObject({
      success: false,
      error: { statusCode: 500, logCreated: true },
    })
  })
})

describe('preprocessExecution resolvedActorUserId reuse', () => {
  const baseOptions = {
    workflowId: 'workflow-1',
    userId: 'owner-1',
    triggerType: 'webhook' as const,
    executionId: 'execution-1',
    requestId: 'request-1',
    checkDeployment: false,
    checkRateLimit: false,
    skipConcurrencyReservation: true,
    workspaceId: 'workspace-1',
    workflowRecord: { id: 'workflow-1', workspaceId: 'workspace-1', isDeployed: true } as any,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('billed-account-1')
    mockGetActivelyBannedUserIds.mockResolvedValue([])
    vi.mocked(getHighestPrioritySubscription).mockResolvedValue({ plan: 'free' } as any)
    vi.mocked(checkServerSideUsageLimits).mockResolvedValue({
      isExceeded: false,
      currentUsage: 1,
      limit: 10,
    } as any)
  })

  it('skips the workspace billed-account lookup when an actor is pre-resolved', async () => {
    const result = await preprocessExecution({
      ...baseOptions,
      resolvedActorUserId: 'pre-resolved-actor',
    })

    expect(result.success).toBe(true)
    expect(result.actorUserId).toBe('pre-resolved-actor')
    expect(mockGetWorkspaceBilledAccountUserId).not.toHaveBeenCalled()
  })

  it('still runs the ban gate against the pre-resolved actor', async () => {
    mockGetActivelyBannedUserIds.mockResolvedValue(['pre-resolved-actor'])

    const result = await preprocessExecution({
      ...baseOptions,
      resolvedActorUserId: 'pre-resolved-actor',
    })

    expect(result).toMatchObject({ success: false, error: { statusCode: 403 } })
    expect(mockGetActivelyBannedUserIds).toHaveBeenCalledWith(
      expect.arrayContaining(['pre-resolved-actor'])
    )
  })

  it('falls back to the billed-account lookup when no actor is pre-resolved', async () => {
    const result = await preprocessExecution(baseOptions)

    expect(result.success).toBe(true)
    expect(result.actorUserId).toBe('billed-account-1')
    expect(mockGetWorkspaceBilledAccountUserId).toHaveBeenCalledTimes(1)
  })
})
