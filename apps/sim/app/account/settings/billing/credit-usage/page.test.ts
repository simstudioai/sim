/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPersonalSubscription, mockGetSession, mockIsEnterprise, mockRedirect } = vi.hoisted(
  () => ({
    mockGetPersonalSubscription: vi.fn(),
    mockGetSession: vi.fn(),
    mockIsEnterprise: vi.fn(),
    mockRedirect: vi.fn(),
  })
)

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPriorityPersonalSubscription: mockGetPersonalSubscription,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isEnterprise: mockIsEnterprise,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/billing/credit-usage/credit-usage-view', () => ({
  CreditUsageView: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/billing/credit-usage/loading', () => ({
  default: () => null,
}))

import AccountCreditUsagePage from '@/app/account/settings/billing/credit-usage/page'

describe('AccountCreditUsagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-a' } })
    mockGetPersonalSubscription.mockResolvedValue({ plan: 'pro_6000' })
    mockIsEnterprise.mockReturnValue(false)
  })

  it('checks only the viewer personal subscription', async () => {
    await AccountCreditUsagePage()

    expect(mockGetPersonalSubscription).toHaveBeenCalledWith('viewer-a')
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
