/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetHighestPrioritySubscription, mockResolveWorkspaceBillingPayer, billingState } =
  vi.hoisted(() => ({
    mockGetHighestPrioritySubscription: vi.fn(),
    mockResolveWorkspaceBillingPayer: vi.fn(),
    billingState: { isBillingEnabled: true, isFreeApiDeploymentGateEnabled: true },
  }))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return billingState.isBillingEnabled
  },
  get isFreeApiDeploymentGateEnabled() {
    return billingState.isFreeApiDeploymentGateEnabled
  },
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveWorkspaceBillingPayer: mockResolveWorkspaceBillingPayer,
}))

import { isWorkspaceApiExecutionEntitled } from '@/lib/billing/core/api-access'

describe('isWorkspaceApiExecutionEntitled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    billingState.isBillingEnabled = true
    billingState.isFreeApiDeploymentGateEnabled = true
  })

  it('is false when the exact workspace payer is free', async () => {
    mockResolveWorkspaceBillingPayer.mockResolvedValue({
      billedAccountUserId: 'owner-1',
      organizationId: 'org-1',
      payerSubscription: { plan: 'free' },
    })
    expect(await isWorkspaceApiExecutionEntitled('ws-1')).toBe(false)
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  it('is true when the exact workspace payer is paid', async () => {
    mockResolveWorkspaceBillingPayer.mockResolvedValue({
      billedAccountUserId: 'owner-1',
      organizationId: 'org-1',
      payerSubscription: { plan: 'team_6000' },
    })
    expect(await isWorkspaceApiExecutionEntitled('ws-1')).toBe(true)
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  it('does not substitute another subscription held by the billed account owner', async () => {
    mockResolveWorkspaceBillingPayer.mockResolvedValue({
      billedAccountUserId: 'owner-1',
      organizationId: 'free-org',
      payerSubscription: null,
    })
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'enterprise' })

    expect(await isWorkspaceApiExecutionEntitled('ws-1')).toBe(false)
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  it('is false when the workspace has no resolvable payer', async () => {
    mockResolveWorkspaceBillingPayer.mockResolvedValue(null)
    expect(await isWorkspaceApiExecutionEntitled('ws-1')).toBe(false)
  })

  it('skips the billed-account lookup on self-hosted', async () => {
    billingState.isBillingEnabled = false
    expect(await isWorkspaceApiExecutionEntitled('ws-1')).toBe(true)
    expect(mockResolveWorkspaceBillingPayer).not.toHaveBeenCalled()
  })

  it('skips the lookup (gate off) when the feature flag is disabled', async () => {
    billingState.isFreeApiDeploymentGateEnabled = false
    expect(await isWorkspaceApiExecutionEntitled('ws-1')).toBe(true)
    expect(mockResolveWorkspaceBillingPayer).not.toHaveBeenCalled()
  })
})
