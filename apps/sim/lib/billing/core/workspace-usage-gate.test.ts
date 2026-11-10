import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/attribution', () => billingAttributionMock)

import { checkWorkspaceUsageGate } from '@/lib/billing/core/workspace-usage-gate'

const { mockCheckAttributedUsageLimits, mockResolveBillingAttribution } = billingAttributionMockFns

describe('checkWorkspaceUsageGate', () => {
  beforeEach(() => {
    mockResolveBillingAttribution.mockImplementation(
      ({ actorUserId, workspaceId }: { actorUserId: string; workspaceId: string }) => ({
        actorUserId,
        billedAccountUserId: 'owner-from-workspace',
        billingEntity: { type: 'organization', id: 'org-b' },
        billingPeriod: { start: '2026-07-01', end: '2026-08-01' },
        organizationId: 'org-b',
        payerSubscription: null,
        workspaceId,
      })
    )
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 40, limit: 100 },
      memberUsage: { currentUsage: 5, limit: 25 },
    })
  })

  it('checks the workspace payer before the acting member', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      message: 'Workspace pool exhausted.',
      payerUsage: { currentUsage: 100, limit: 100 },
      scope: 'payer',
    })

    await expect(
      checkWorkspaceUsageGate({
        actorUserId: 'external-a',
        workspaceId: 'workspace-b',
      })
    ).resolves.toEqual({
      isExceeded: true,
      message: 'Workspace pool exhausted.',
      scope: 'payer',
    })
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'external-a',
      workspaceId: 'workspace-b',
    })
  })

  it('checks the actor member cap only after the payer allows usage', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      message: 'Member cap exhausted.',
      payerUsage: { currentUsage: 40, limit: 100 },
      memberUsage: { currentUsage: 25, limit: 25 },
      scope: 'member',
    })

    await expect(
      checkWorkspaceUsageGate({
        actorUserId: 'external-a',
        workspaceId: 'workspace-b',
      })
    ).resolves.toEqual({
      isExceeded: true,
      message: 'Member cap exhausted.',
      scope: 'member',
    })
    expect(mockCheckAttributedUsageLimits).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'external-a',
        organizationId: 'org-b',
      })
    )
  })

  it('preserves actor account blocks instead of relabeling them as payer failures', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      message: 'Account frozen.',
      scope: 'actor',
    })

    await expect(
      checkWorkspaceUsageGate({
        actorUserId: 'external-a',
        workspaceId: 'workspace-b',
      })
    ).resolves.toEqual({
      isExceeded: true,
      message: 'Account frozen.',
      scope: 'actor',
    })
  })
})
