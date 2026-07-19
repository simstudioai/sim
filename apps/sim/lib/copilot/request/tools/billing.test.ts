/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamingContext,
} from '@/lib/copilot/request/types'

const { mockGetHighestPrioritySubscription } = vi.hoisted(() => ({
  mockGetHighestPrioritySubscription: vi.fn(),
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/copilot/request/handlers', () => ({
  sseHandlers: {},
}))

import { handleBillingLimitResponse } from '@/lib/copilot/request/tools/billing'

const context = { streamComplete: false } as StreamingContext

function createExecutionContext(
  billingAttribution?: ExecutionContext['billingAttribution']
): ExecutionContext {
  return { billingAttribution } as ExecutionContext
}

describe('handleBillingLimitResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the workspace payer plan instead of the actor highest-priority plan', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'enterprise' })
    const onEvent = vi.fn()
    const execContext = createExecutionContext({
      actorUserId: 'actor-1',
      workspaceId: 'ws-1',
      organizationId: 'org-1',
      billedAccountUserId: 'owner-1',
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: null,
    })

    await handleBillingLimitResponse('actor-1', context, execContext, {
      onEvent,
    } as OrchestratorOptions)

    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      payload: { text: expect.stringContaining('"action":"upgrade_plan"') },
    })
  })

  it('renders an organization limit action from the attributed payer snapshot', async () => {
    const onEvent = vi.fn()
    const execContext = createExecutionContext({
      actorUserId: 'actor-1',
      workspaceId: 'ws-1',
      organizationId: 'org-1',
      billedAccountUserId: 'owner-1',
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: {
        id: 'sub-1',
        referenceId: 'org-1',
        plan: 'team',
        status: 'active',
        seats: 4,
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-08-01T00:00:00.000Z',
      },
    })

    await handleBillingLimitResponse('actor-1', context, execContext, {
      onEvent,
    } as OrchestratorOptions)

    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      payload: {
        text: expect.stringMatching(/"action":"increase_limit".*organization owner or admin/),
      },
    })
  })

  it('retains account-only subscription fallback without an attribution snapshot', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({
      plan: 'pro',
      referenceId: 'actor-1',
    })
    const onEvent = vi.fn()

    await handleBillingLimitResponse('actor-1', context, createExecutionContext(), {
      onEvent,
    } as OrchestratorOptions)

    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledWith('actor-1')
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      payload: { text: expect.stringContaining('"action":"increase_limit"') },
    })
  })
})
