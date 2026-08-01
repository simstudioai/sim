/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreditUsageLoading, mockGetPersonalSubscription, mockIsEnterprise, mockRedirect } =
  vi.hoisted(() => ({
    mockCreditUsageLoading: vi.fn(() => null),
    mockGetPersonalSubscription: vi.fn(),
    mockIsEnterprise: vi.fn(),
    mockRedirect: vi.fn(),
  }))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
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
  CreditUsageLoading: mockCreditUsageLoading,
}))

import AccountCreditUsagePage from '@/app/account/settings/billing/credit-usage/page'

const mockGetSession = authMockFns.mockGetSession

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

  it('uses an account-scoped back link while credit usage is loading', async () => {
    const page = await AccountCreditUsagePage()

    expect(page.props.fallback).toMatchObject({
      type: mockCreditUsageLoading,
      props: { backHref: '/account/settings/billing' },
    })
  })
})
