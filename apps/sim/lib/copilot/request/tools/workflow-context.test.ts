/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { ADMISSION_ERROR_CODE } from '@/lib/core/admission/transient-failure'

const { checkAttributedUsageLimitsMock, reserveExecutionSlotMock, resolveBillingAttributionMock } =
  vi.hoisted(() => ({
    checkAttributedUsageLimitsMock: vi.fn(),
    reserveExecutionSlotMock: vi.fn(),
    resolveBillingAttributionMock: vi.fn(),
  }))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  checkAttributedUsageLimits: checkAttributedUsageLimitsMock,
  resolveBillingAttribution: resolveBillingAttributionMock,
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  reserveExecutionSlot: reserveExecutionSlotMock,
  UsageReservationUnavailableError: class UsageReservationUnavailableError extends Error {
    readonly code = ADMISSION_ERROR_CODE.RESERVATION_INFRASTRUCTURE
    readonly statusCode = 503
    readonly retryable = true
  },
}))

import {
  applyCreateWorkflowOutputToContext,
  prepareWorkflowExecutionAdmission,
  resolveWorkflowExecutionBillingAttribution,
  WorkflowExecutionAdmissionError,
} from '@/lib/copilot/request/tools/workflow-context'
import type { ExecutionContext } from '@/lib/copilot/request/types'

const billingAttribution: BillingAttributionSnapshot = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'owner-1',
  billingEntity: { type: 'user', id: 'owner-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

const childBillingAttribution: BillingAttributionSnapshot = Object.freeze({
  actorUserId: 'user-1',
  workspaceId: 'workspace-2',
  organizationId: 'organization-2',
  billedAccountUserId: 'owner-2',
  billingEntity: { type: 'organization', id: 'organization-2' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
})

function createContext(): ExecutionContext {
  return {
    userId: 'user-1',
    workflowId: '',
    workspaceId: 'workspace-1',
    billingAttribution,
  }
}

describe('create_workflow execution context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkAttributedUsageLimitsMock.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 1, limit: 10 },
    })
    reserveExecutionSlotMock.mockResolvedValue({ reserved: true, created: true })
  })

  it('adopts a same-workspace workflow without replacing its billing snapshot', () => {
    const context = createContext()

    applyCreateWorkflowOutputToContext(
      { workflowId: 'workflow-2', workspaceId: 'workspace-1' },
      context
    )

    expect(context).toMatchObject({
      userId: 'user-1',
      workflowId: 'workflow-2',
      workspaceId: 'workspace-1',
      billingAttribution,
    })
    expect(context.billingAttribution).toBe(billingAttribution)
  })

  it('adopts a cross-workspace workflow without replacing its root billing snapshot', () => {
    const context = createContext()

    applyCreateWorkflowOutputToContext(
      { workflowId: 'workflow-2', workspaceId: 'workspace-2' },
      context
    )

    expect(context).toMatchObject({
      userId: 'user-1',
      workflowId: 'workflow-2',
      workspaceId: 'workspace-2',
      billingAttribution,
    })
    expect(context.billingAttribution).toBe(billingAttribution)
  })

  it('reuses the root snapshot for same-workspace workflow execution', async () => {
    const context = createContext()

    const attribution = await resolveWorkflowExecutionBillingAttribution(context, 'workspace-1')

    expect(attribution).toBe(billingAttribution)
    expect(resolveBillingAttributionMock).not.toHaveBeenCalled()
  })

  it('does not implicitly resolve billing without a root lifecycle snapshot', async () => {
    const context = { ...createContext(), billingAttribution: undefined }

    const attribution = await resolveWorkflowExecutionBillingAttribution(context, 'workspace-2')

    expect(attribution).toBeUndefined()
    expect(resolveBillingAttributionMock).not.toHaveBeenCalled()
  })

  it('resolves one child snapshot for cross-workspace workflow execution', async () => {
    const context = createContext()
    resolveBillingAttributionMock.mockResolvedValue(childBillingAttribution)

    const attribution = await resolveWorkflowExecutionBillingAttribution(context, 'workspace-2')

    expect(resolveBillingAttributionMock).toHaveBeenCalledOnce()
    expect(resolveBillingAttributionMock).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      workspaceId: 'workspace-2',
    })
    expect(attribution).toBe(childBillingAttribution)
    expect(attribution).not.toBe(billingAttribution)
    expect(Object.isFrozen(attribution)).toBe(true)
    expect(context.billingAttribution).toBe(billingAttribution)
  })
})

describe('prepareWorkflowExecutionAdmission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveBillingAttributionMock.mockResolvedValue(childBillingAttribution)
    checkAttributedUsageLimitsMock.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 1, limit: 10 },
    })
  })

  it.each([
    {
      reason: 'payer_concurrency' as const,
      code: ADMISSION_ERROR_CODE.RESERVATION_CONCURRENCY,
      statusCode: 429,
      retryable: true,
      message: 'Target workspace execution concurrency is currently exhausted',
    },
    {
      reason: 'payer_headroom' as const,
      code: ADMISSION_ERROR_CODE.RESERVATION_PAYER_HEADROOM,
      statusCode: 402,
      retryable: false,
      message: 'Target workspace payer usage headroom is currently exhausted',
    },
    {
      reason: 'member_headroom' as const,
      code: ADMISSION_ERROR_CODE.RESERVATION_MEMBER_HEADROOM,
      statusCode: 402,
      retryable: false,
      message: 'Target workspace member usage headroom is currently exhausted',
    },
  ])(
    'maps $reason with target-specific wording',
    async ({ reason, code, statusCode, retryable, message }) => {
      reserveExecutionSlotMock.mockResolvedValueOnce({ reserved: false, reason })

      try {
        await prepareWorkflowExecutionAdmission(createContext(), 'workspace-2', 'child-execution-1')
        throw new Error('Expected target admission to reject the reservation')
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowExecutionAdmissionError)
        expect(error).toMatchObject({ code, statusCode, retryable, message })
      }
    }
  )
})
