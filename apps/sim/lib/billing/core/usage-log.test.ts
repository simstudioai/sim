/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetHighestPrioritySubscription,
  mockInsert,
  mockIsOrgScopedSubscription,
  mockOnConflictDoNothing,
  mockReturning,
  mockValues,
} = vi.hoisted(() => ({
  mockGetHighestPrioritySubscription: vi.fn(),
  mockInsert: vi.fn(),
  mockIsOrgScopedSubscription: vi.fn(),
  mockOnConflictDoNothing: vi.fn(),
  mockReturning: vi.fn(),
  mockValues: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    insert: mockInsert,
  },
}))

vi.mock('@sim/db/schema', () => ({
  usageLog: {
    billingEntityId: 'usageLog.billingEntityId',
    billingEntityType: 'usageLog.billingEntityType',
    billingPeriodEnd: 'usageLog.billingPeriodEnd',
    billingPeriodStart: 'usageLog.billingPeriodStart',
    category: 'usageLog.category',
    cost: 'usageLog.cost',
    createdAt: 'usageLog.createdAt',
    description: 'usageLog.description',
    eventKey: 'usageLog.eventKey',
    executionId: 'usageLog.executionId',
    id: 'usageLog.id',
    metadata: 'usageLog.metadata',
    source: 'usageLog.source',
    userId: 'usageLog.userId',
    workflowId: 'usageLog.workflowId',
    workspaceId: 'usageLog.workspaceId',
  },
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  isOrgScopedSubscription: mockIsOrgScopedSubscription,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isBillingEnabled: true,
}))

import { recordUsage } from '@/lib/billing/core/usage-log'

describe('recordUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReturning.mockResolvedValue([{ cost: '0.10' }, { cost: '0.20' }])
    mockOnConflictDoNothing.mockReturnValue({ returning: mockReturning })
    mockValues.mockReturnValue({
      onConflictDoNothing: mockOnConflictDoNothing,
    })
    mockInsert.mockReturnValue({ values: mockValues })
    mockGetHighestPrioritySubscription.mockResolvedValue({
      periodEnd: new Date('2026-06-01T00:00:00.000Z'),
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      referenceId: 'org-1',
    })
    mockIsOrgScopedSubscription.mockReturnValue(true)
  })

  it('commits canonical usage rows with deterministic event keys and billing scope', async () => {
    await recordUsage({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      entries: [
        { category: 'fixed', source: 'workflow', description: 'execution_fee', cost: 0.1 },
        {
          category: 'model',
          source: 'workflow',
          description: 'gpt-4',
          cost: 0.2,
          metadata: { inputTokens: 10, outputTokens: 20 },
        },
      ],
    })

    const values = mockValues.mock.calls[0][0]
    expect(values).toHaveLength(2)
    expect(values[0]).toMatchObject({
      billingEntityId: 'org-1',
      billingEntityType: 'organization',
      billingPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
      billingPeriodStart: new Date('2026-05-01T00:00:00.000Z'),
    })
    expect(values[0].eventKey).toMatch(/^[a-f0-9]{64}$/)
    expect(values[1].eventKey).toMatch(/^[a-f0-9]{64}$/)
    expect(values[0].eventKey).not.toBe(values[1].eventKey)
    expect(mockOnConflictDoNothing).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'usageLog.eventKey' })
    )
  })

  it('uses pre-resolved billing context without loading subscriptions', async () => {
    await recordUsage({
      userId: 'user-1',
      billingEntity: { type: 'user', id: 'user-1' },
      billingPeriod: {
        start: new Date('2026-05-01T00:00:00.000Z'),
        end: new Date('2026-06-01T00:00:00.000Z'),
      },
      entries: [{ category: 'fixed', source: 'workflow', description: 'execution_fee', cost: 0.1 }],
    })

    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
    expect(mockValues.mock.calls[0][0][0]).toMatchObject({
      billingEntityId: 'user-1',
      billingEntityType: 'user',
    })
  })
})
