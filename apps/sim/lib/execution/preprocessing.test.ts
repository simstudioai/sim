/**
 * @vitest-environment node
 */

import { loggingSessionMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMISSION_ERROR_CODE } from '@/lib/core/admission/transient-failure'

const {
  mockCheckAttributedUsageLimits,
  mockCheckRateLimit,
  mockGetActivelyBannedUserIds,
  mockReserveExecutionSlot,
  mockResolveBillingAttribution,
  mockResolveSystemBillingAttribution,
} = vi.hoisted(() => ({
  mockCheckAttributedUsageLimits: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetActivelyBannedUserIds: vi.fn().mockResolvedValue([]),
  mockReserveExecutionSlot: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockResolveSystemBillingAttribution: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@/lib/auth/ban', () => ({
  getActivelyBannedUserIds: mockGetActivelyBannedUserIds,
}))
vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkServerSideUsageLimits: vi.fn(),
}))
vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  reserveExecutionSlot: mockReserveExecutionSlot,
  UsageReservationUnavailableError: class UsageReservationUnavailableError extends Error {
    readonly code = 'SERVICE_OVERLOADED'
    readonly statusCode = 503
    readonly retryable = true
  },
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: vi.fn((value) => value),
  checkAttributedUsageLimits: mockCheckAttributedUsageLimits,
  resolveBillingAttribution: mockResolveBillingAttribution,
  resolveSystemBillingAttribution: mockResolveSystemBillingAttribution,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: vi.fn(),
}))
vi.mock('@/lib/core/execution-limits', () => ({
  getExecutionTimeout: vi.fn(() => 0),
}))
vi.mock('@/lib/core/rate-limiter/rate-limiter', () => ({
  RateLimiter: vi.fn(function (this: unknown) {
    return { checkRateLimitWithSubscription: mockCheckRateLimit }
  }),
}))
vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@sim/platform-authz/workflow', () => ({
  getActiveWorkflowRecord: vi.fn().mockResolvedValue({
    id: 'workflow-1',
    userId: 'creator-1',
    workspaceId: 'workspace-1',
    isDeployed: true,
  }),
}))

import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { preprocessExecution } from './preprocessing'

const ORGANIZATION_ATTRIBUTION = {
  actorUserId: 'actor-1',
  billedAccountUserId: 'owner-1',
  billingEntity: { type: 'organization' as const, id: 'org-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  organizationId: 'org-1',
  payerSubscription: {
    id: 'payer-sub-1',
    periodEnd: '2026-08-01T00:00:00.000Z',
    periodStart: '2026-07-01T00:00:00.000Z',
    plan: 'team_25000',
    referenceId: 'org-1',
    seats: 3,
    status: 'active',
  },
  workspaceId: 'workspace-1',
}

beforeEach(() => {
  mockResolveBillingAttribution.mockImplementation(
    ({ actorUserId, workspaceId }: { actorUserId: string; workspaceId: string }) => ({
      ...ORGANIZATION_ATTRIBUTION,
      actorUserId,
      workspaceId,
    })
  )
  mockResolveSystemBillingAttribution.mockImplementation((workspaceId: string) => ({
    ...ORGANIZATION_ATTRIBUTION,
    actorUserId: 'billed-account-1',
    billedAccountUserId: 'billed-account-1',
    workspaceId,
  }))
  mockCheckAttributedUsageLimits.mockResolvedValue({
    isExceeded: false,
    payerUsage: { currentUsage: 1, limit: 10 },
  })
  mockReserveExecutionSlot.mockResolvedValue({ reserved: true })
})

describe('preprocessExecution correlation logging', () => {
  it('preserves trigger correlation when logging preprocessing failures', async () => {
    mockResolveSystemBillingAttribution.mockRejectedValueOnce(
      new Error('Unable to resolve billing payer')
    )

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
    vi.mocked(getHighestPrioritySubscription).mockResolvedValue({ plan: 'free' } as any)
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 1, limit: 10 },
    })
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 100,
      resetAt: new Date(),
    })
  })

  it('suppresses preprocessing-error logging when logPreprocessingErrors is false', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValueOnce({
      isExceeded: true,
      message: 'Usage limit exceeded. Please upgrade your plan to continue.',
      payerUsage: { currentUsage: 20, limit: 10 },
      scope: 'payer',
    })

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
    mockGetActivelyBannedUserIds.mockResolvedValue([])
    vi.mocked(getHighestPrioritySubscription).mockResolvedValue({ plan: 'free' } as any)
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 1, limit: 10 },
    })
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
      error: { statusCode: 403, message: 'Account suspended' },
    })
    expect(loggingSession.safeStart).toHaveBeenCalled()
  })

  it('returns 403 (ban precedence) when ban, usage, and rate limit all fail simultaneously', async () => {
    mockGetActivelyBannedUserIds.mockResolvedValue(['billed-account-1'])
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      message: 'Usage limit exceeded. Please upgrade your plan to continue.',
      payerUsage: { currentUsage: 20, limit: 10 },
      scope: 'payer',
    })
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

    expect(result).toMatchObject({
      success: false,
      error: { statusCode: 403, message: 'Account suspended' },
    })
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(loggingSession.safeStart).toHaveBeenCalledOnce()
    expect(loggingSession.safeCompleteWithError).toHaveBeenCalledWith({
      error: {
        message: 'This account has been suspended. Workflow executions are blocked.',
        stackTrace: undefined,
      },
      traceSpans: [],
      skipCost: true,
    })
  })

  it('starts ban, subscription, and usage reads concurrently before rate limiting', async () => {
    let resolveBan!: (value: string[]) => void
    let resolveSubscription!: (value: { plan: string }) => void
    let resolveUsage!: (value: {
      isExceeded: boolean
      payerUsage: { currentUsage: number; limit: number }
    }) => void
    mockGetActivelyBannedUserIds.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        resolveBan = resolve
      })
    )
    vi.mocked(getHighestPrioritySubscription).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubscription = resolve
      }) as never
    )
    mockCheckAttributedUsageLimits.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUsage = resolve
      })
    )
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: true,
      remaining: 5,
      resetAt: new Date('2026-07-10T00:00:00.000Z'),
    })

    const resultPromise = preprocessExecution({
      ...baseOptions,
      checkRateLimit: true,
      skipConcurrencyReservation: true,
    })

    await vi
      .waitFor(() => {
        expect(mockGetActivelyBannedUserIds).toHaveBeenCalledOnce()
        expect(getHighestPrioritySubscription).toHaveBeenCalledOnce()
        expect(mockCheckAttributedUsageLimits).toHaveBeenCalledOnce()
        expect(mockCheckRateLimit).not.toHaveBeenCalled()
      })
      .finally(() => {
        resolveBan([])
        resolveSubscription({ plan: 'free' })
        resolveUsage({
          isExceeded: false,
          payerUsage: { currentUsage: 1, limit: 10 },
        })
      })

    await expect(resultPromise).resolves.toMatchObject({ success: true })
    expect(mockCheckRateLimit).toHaveBeenCalledOnce()
  })

  it('does not debit rate-limit quota when the ban gate rejects', async () => {
    mockGetActivelyBannedUserIds.mockResolvedValue(['billed-account-1'])

    const result = await preprocessExecution({ ...baseOptions, checkRateLimit: true })

    expect(result).toMatchObject({ success: false, error: { statusCode: 403 } })
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('does not debit rate-limit quota when the usage gate rejects', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      message: 'Usage limit exceeded. Please upgrade your plan to continue.',
      payerUsage: { currentUsage: 20, limit: 10 },
      scope: 'payer',
    })

    const result = await preprocessExecution({ ...baseOptions, checkRateLimit: true })

    expect(result).toMatchObject({ success: false, error: { statusCode: 402 } })
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('consumes the rate-limit gate exactly once when the ban and usage gates pass', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 5, resetAt: new Date() })

    const result = await preprocessExecution({
      ...baseOptions,
      checkRateLimit: true,
      skipConcurrencyReservation: true,
    })

    expect(result.success).toBe(true)
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1)
  })

  it('checks the actor, caller-provided userId, and workflow owner in one call', async () => {
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
      error: { statusCode: 500 },
    })
  })
})

describe('preprocessExecution system attribution', () => {
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
    mockGetActivelyBannedUserIds.mockResolvedValue([])
    vi.mocked(getHighestPrioritySubscription).mockResolvedValue({ plan: 'free' } as any)
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 1, limit: 10 },
    })
  })

  it('resolves the system actor and payer atomically', async () => {
    mockResolveSystemBillingAttribution.mockResolvedValueOnce({
      ...ORGANIZATION_ATTRIBUTION,
      actorUserId: 'atomic-owner',
      billedAccountUserId: 'atomic-owner',
    })

    const result = await preprocessExecution(baseOptions)

    expect(result.success).toBe(true)
    expect(result).toMatchObject({
      actorUserId: 'atomic-owner',
      billingAttribution: {
        actorUserId: 'atomic-owner',
        billedAccountUserId: 'atomic-owner',
      },
    })
    expect(mockResolveSystemBillingAttribution).toHaveBeenCalledWith('workspace-1')
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
  })
})

describe('preprocessExecution billing attribution', () => {
  const baseOptions = {
    workflowId: 'workflow-1',
    userId: 'external-actor',
    triggerType: 'api' as const,
    executionId: 'execution-1',
    requestId: 'request-1',
    checkDeployment: false,
    checkRateLimit: true,
    useAuthenticatedUserAsActor: true,
    workflowRecord: {
      id: 'workflow-1',
      userId: 'creator-1',
      workspaceId: 'workspace-1',
      isDeployed: true,
    } as any,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetActivelyBannedUserIds.mockResolvedValue([])
    vi.mocked(getHighestPrioritySubscription).mockResolvedValue({
      id: 'actor-subscription',
      plan: 'pro_100',
      referenceId: 'external-actor',
    } as any)
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetAt: new Date('2026-07-10T00:00:00.000Z'),
    })
  })

  it.each([
    ['external session actor', 'external-actor'],
    ['personal API-key owner', 'personal-key-owner'],
    ['internal organization member', 'internal-member'],
  ])('keeps the %s as actor while the workspace organization pays', async (_label, actorUserId) => {
    const result = await preprocessExecution({ ...baseOptions, userId: actorUserId })

    expect(result).toMatchObject({
      success: true,
      actorUserId,
      actorSubscription: {
        id: 'actor-subscription',
      },
      billingAttribution: {
        actorUserId,
        billedAccountUserId: 'owner-1',
        billingEntity: { type: 'organization', id: 'org-1' },
      },
    })
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId,
      workspaceId: 'workspace-1',
    })
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      actorUserId,
      expect.objectContaining({ id: 'actor-subscription' }),
      'api',
      false
    )
    expect(mockReserveExecutionSlot).toHaveBeenCalledWith({
      billingEntity: { type: 'organization', id: 'org-1' },
      reservationId: 'execution-1',
      plan: 'team_25000',
      currentUsage: 1,
      limit: 10,
    })
  })

  it('forwards the frozen Enterprise concurrency override to admission', async () => {
    const enterpriseAttribution = {
      ...ORGANIZATION_ATTRIBUTION,
      payerSubscription: {
        ...ORGANIZATION_ATTRIBUTION.payerSubscription,
        plan: 'enterprise',
        enterpriseConcurrencyLimit: 1250,
      },
    }

    const result = await preprocessExecution({
      ...baseOptions,
      userId: 'ignored-current-user',
      useAuthenticatedUserAsActor: false,
      billingAttribution: enterpriseAttribution,
    })

    expect(result.success).toBe(true)
    expect(mockReserveExecutionSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: 'enterprise',
        enterpriseConcurrencyLimit: 1250,
      })
    )
  })

  it('reuses a serialized attribution snapshot without re-resolving the payer', async () => {
    const result = await preprocessExecution({
      ...baseOptions,
      userId: 'ignored-current-user',
      useAuthenticatedUserAsActor: false,
      billingAttribution: ORGANIZATION_ATTRIBUTION,
      skipConcurrencyReservation: true,
    })

    expect(result).toMatchObject({
      success: true,
      actorUserId: 'actor-1',
      billingAttribution: ORGANIZATION_ATTRIBUTION,
    })
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
  })

  it('atomically reserves the exact organization member constraint from the usage snapshot', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValueOnce({
      isExceeded: false,
      payerUsage: { currentUsage: 1, limit: 10 },
      memberUsage: { currentUsage: 2, limit: 3 },
    })
    mockReserveExecutionSlot.mockResolvedValueOnce({ reserved: true, created: true })

    const result = await preprocessExecution({
      ...baseOptions,
      billingAttribution: ORGANIZATION_ATTRIBUTION,
    })

    expect(result).toMatchObject({ success: true })
    expect(mockReserveExecutionSlot).toHaveBeenCalledWith({
      billingEntity: { type: 'organization', id: 'org-1' },
      reservationId: 'execution-1',
      plan: 'team_25000',
      currentUsage: 1,
      limit: 10,
      member: {
        organizationId: 'org-1',
        actorUserId: 'actor-1',
        currentUsage: 2,
        limit: 3,
      },
    })
  })

  it('reserves a resume attempt without changing its parent execution identity', async () => {
    mockReserveExecutionSlot.mockResolvedValueOnce({ reserved: true, created: true })

    const result = await preprocessExecution({
      ...baseOptions,
      executionId: 'parent-execution-1',
      reservationId: 'resume-entry-1',
      billingAttribution: ORGANIZATION_ATTRIBUTION,
    })

    expect(result).toMatchObject({ success: true })
    expect(mockReserveExecutionSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: 'resume-entry-1',
      })
    )
  })

  it.each([
    {
      reason: 'payer_concurrency' as const,
      statusCode: 429,
      code: ADMISSION_ERROR_CODE.RESERVATION_CONCURRENCY,
      retryable: true,
      message: 'Too many concurrent executions',
    },
    {
      reason: 'payer_headroom' as const,
      statusCode: 402,
      code: ADMISSION_ERROR_CODE.RESERVATION_PAYER_HEADROOM,
      retryable: false,
      message: 'billing account has no guaranteed base-charge headroom',
    },
    {
      reason: 'member_headroom' as const,
      statusCode: 402,
      code: ADMISSION_ERROR_CODE.RESERVATION_MEMBER_HEADROOM,
      retryable: false,
      message: 'organization member usage limit has no guaranteed base-charge headroom',
    },
  ])(
    'maps $reason to stable admission metadata while retaining local wording',
    async ({ reason, statusCode, code, retryable, message }) => {
      mockCheckAttributedUsageLimits.mockResolvedValueOnce({
        isExceeded: false,
        payerUsage: { currentUsage: 1, limit: 10 },
        memberUsage: { currentUsage: 2, limit: 3 },
      })
      mockReserveExecutionSlot.mockResolvedValueOnce({
        reserved: false,
        reason,
      })

      const result = await preprocessExecution({
        ...baseOptions,
        billingAttribution: ORGANIZATION_ATTRIBUTION,
        logPreprocessingErrors: false,
      })

      expect(result).toMatchObject({
        success: false,
        error: {
          statusCode,
          code,
          retryable,
          cause: { code, constraint: reason },
        },
      })
      if (result.success) throw new Error('Expected preprocessing to reject the reservation')
      expect(result.error.message).toContain(message)
    }
  )

  it('fails closed with retryable 503 when reservation infrastructure errors', async () => {
    mockReserveExecutionSlot.mockRejectedValueOnce(new Error('redis unavailable'))

    const result = await preprocessExecution({
      ...baseOptions,
      billingAttribution: ORGANIZATION_ATTRIBUTION,
      logPreprocessingErrors: false,
    })

    expect(result).toMatchObject({
      success: false,
      error: {
        statusCode: 503,
        retryable: true,
        code: ADMISSION_ERROR_CODE.RESERVATION_INFRASTRUCTURE,
        cause: { code: 'SERVICE_OVERLOADED' },
      },
    })
  })
})
