import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }))
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/settings/application/organization-section-access', () => ({
  authorizeOrganizationSettingsSection: mocks.authorize,
}))
vi.mock('@/components/settings/account-settings-renderer', () => ({
  AccountSettingsRenderer: () => null,
}))
vi.mock('@/components/settings/prefetch-standalone-general', () => ({
  prefetchStandaloneGeneral: vi.fn(),
}))
vi.mock('@/app/o/[organizationId]/settings/[section]/settings', () => ({
  OrganizationSettings: () => null,
}))

import OrganizationSettingsSectionPage from '@/app/o/[organizationId]/settings/[section]/page'

const mockGetSession = authMockFns.mockGetSession

describe('organization request settings routing', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ user: { id: 'viewer' } })
    mocks.authorize.mockResolvedValue(true)
  })

  it('conceals requests from viewers rejected by the organization gate', async () => {
    mocks.authorize.mockResolvedValue(false)
    await expect(
      OrganizationSettingsSectionPage({
        params: Promise.resolve({ organizationId: 'organization', section: 'access-control' }),
        searchParams: Promise.resolve({ 'access-view': 'requests' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
