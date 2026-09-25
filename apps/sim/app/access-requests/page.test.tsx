import { authMockFns } from '@sim/testing'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { organizationContext, organizationAccess } = vi.hoisted(() => ({
  organizationContext: vi.fn(),
  organizationAccess: vi.fn(),
}))
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/organizations/surface', () => ({
  getOrganizationSurfaceContext: organizationContext,
}))
vi.mock('@/ee/access-requests/components/access-requests-settings', () => ({
  AccessRequestsSettings: () => null,
}))
vi.mock('@/lib/organizations/settings-access', () => ({
  getOrganizationSettingsAccess: organizationAccess,
}))

import AccessRequestsPage from '@/app/access-requests/page'

const mockRedirect = nextNavigationMockFns.mockRedirect

describe('access request sign-in redirect', () => {
  beforeEach(() => {
    organizationAccess.mockResolvedValue({ isAdmin: false, isMember: true })
    authMockFns.mockGetSession.mockResolvedValue(null)
  })

  it('drops invalid and unsupported state instead of forwarding raw query parameters', async () => {
    await expect(
      AccessRequestsPage({
        searchParams: Promise.resolve({
          organizationId: 'organization',
          view: 'invalid',
          page: '40001',
          search: 'x'.repeat(201),
          requestId: 'x'.repeat(129),
          'request-page': '-1',
          'request-status': 'invalid',
          callbackUrl: 'https://example.com/untrusted',
        }),
      })
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith(
      `/login?callbackUrl=${encodeURIComponent('/access-requests?organizationId=organization')}`
    )
  })
})
