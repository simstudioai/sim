/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckAttributedUsageLimits, mockResolveBillingAttribution } = vi.hoisted(() => ({
  mockCheckAttributedUsageLimits: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  checkAttributedUsageLimits: mockCheckAttributedUsageLimits,
  resolveBillingAttribution: mockResolveBillingAttribution,
}))

import {
  checkWorkspaceUsageGate,
  getWorkspaceCreditAvailability,
} from '@/lib/billing/core/workspace-usage-gate'

describe('getWorkspaceCreditAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('shows a target-organization admin the host pool availability', async () => {
    await expect(
      getWorkspaceCreditAvailability({
        actorUserId: 'admin-b',
        workspaceId: 'workspace-b',
        canViewPayerPool: true,
      })
    ).resolves.toEqual({ remainingDollars: 60, scope: 'payer' })
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'admin-b',
      workspaceId: 'workspace-b',
    })
  })

  it('shows an ordinary member the tighter effective member availability', async () => {
    await expect(
      getWorkspaceCreditAvailability({
        actorUserId: 'member-b',
        workspaceId: 'workspace-b',
        canViewPayerPool: false,
      })
    ).resolves.toEqual({ remainingDollars: 20, scope: 'member' })
  })

  it('does not expose the payer pool when no member cap applies', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 40, limit: 100 },
      memberUsage: { currentUsage: 0, limit: null },
    })

    await expect(
      getWorkspaceCreditAvailability({
        actorUserId: 'external-a',
        workspaceId: 'workspace-b',
        canViewPayerPool: false,
      })
    ).resolves.toEqual({
      remainingDollars: null,
      scope: 'effective',
    })
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'external-a',
      workspaceId: 'workspace-b',
    })
    expect(mockCheckAttributedUsageLimits).toHaveBeenCalledWith(
      expect.objectContaining({
        billedAccountUserId: 'owner-from-workspace',
        billingEntity: { type: 'organization', id: 'org-b' },
      })
    )
  })

  it('shows a member cap without exposing a tighter payer balance', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 40, limit: 100 },
      memberUsage: { currentUsage: 5, limit: 100 },
    })

    await expect(
      getWorkspaceCreditAvailability({
        actorUserId: 'member-b',
        workspaceId: 'workspace-b',
        canViewPayerPool: false,
      })
    ).resolves.toEqual({ remainingDollars: 95, scope: 'member' })
  })

  it('shows exhaustion without revealing the payer balance before exhaustion', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      payerUsage: { currentUsage: 100, limit: 100 },
      memberUsage: { currentUsage: 5, limit: null },
      scope: 'payer',
    })

    await expect(
      getWorkspaceCreditAvailability({
        actorUserId: 'member-b',
        workspaceId: 'workspace-b',
        canViewPayerPool: false,
      })
    ).resolves.toEqual({ remainingDollars: 0, scope: 'effective' })
  })
})

describe('checkWorkspaceUsageGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
