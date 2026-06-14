/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetHighestPrioritySubscription, mockGetWorkspaceBilledAccountUserId, billingState } =
  vi.hoisted(() => ({
    mockGetHighestPrioritySubscription: vi.fn(),
    mockGetWorkspaceBilledAccountUserId: vi.fn(),
    billingState: { isBillingEnabled: true },
  }))

vi.mock('@/lib/core/config/feature-flags', () => ({
  get isBillingEnabled() {
    return billingState.isBillingEnabled
  },
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBilledAccountUserId: mockGetWorkspaceBilledAccountUserId,
}))

import {
  isApiExecutionEntitled,
  isWorkspaceApiExecutionEntitled,
} from '@/lib/billing/core/api-access'

describe('isApiExecutionEntitled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    billingState.isBillingEnabled = true
  })

  it('is false for a free plan', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'free' })
    expect(await isApiExecutionEntitled('user-1')).toBe(false)
  })

  it('is false when there is no subscription', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
    expect(await isApiExecutionEntitled('user-1')).toBe(false)
  })

  it.each(['pro', 'pro_6000', 'team', 'team_25000', 'enterprise'])(
    'is true for paid plan %s',
    async (plan) => {
      mockGetHighestPrioritySubscription.mockResolvedValue({ plan })
      expect(await isApiExecutionEntitled('user-1')).toBe(true)
    }
  )

  it('is true on self-hosted regardless of plan, without a subscription lookup', async () => {
    billingState.isBillingEnabled = false
    expect(await isApiExecutionEntitled('user-1')).toBe(true)
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  it('is true when userId is missing', async () => {
    expect(await isApiExecutionEntitled(undefined)).toBe(true)
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })
})

describe('isWorkspaceApiExecutionEntitled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    billingState.isBillingEnabled = true
  })

  it('is false when the workspace billed account is free', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('owner-1')
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'free' })
    expect(await isWorkspaceApiExecutionEntitled('ws-1')).toBe(false)
  })

  it('is true when the workspace billed account is paid', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('owner-1')
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'team_6000' })
    expect(await isWorkspaceApiExecutionEntitled('ws-1')).toBe(true)
  })

  it('skips the billed-account lookup on self-hosted', async () => {
    billingState.isBillingEnabled = false
    expect(await isWorkspaceApiExecutionEntitled('ws-1')).toBe(true)
    expect(mockGetWorkspaceBilledAccountUserId).not.toHaveBeenCalled()
  })
})
