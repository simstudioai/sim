import { authMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { redirect, organizationContext, organizationAccess } = vi.hoisted(() => ({
  redirect: vi.fn(),
  organizationContext: vi.fn(),
  organizationAccess: vi.fn(),
}))
vi.mock('next/navigation', () => ({ redirect }))
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

describe('access request sign-in redirect', () => {
  beforeEach(() => {
    organizationAccess.mockResolvedValue({ isAdmin: false, isMember: true })
    authMockFns.mockGetSession.mockResolvedValue(null)
    redirect.mockImplementation(() => {
      throw new Error('Redirect')
    })
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
    ).rejects.toThrow('Redirect')
    expect(redirect).toHaveBeenCalledWith(
      `/login?callbackUrl=${encodeURIComponent('/access-requests?organizationId=organization')}`
    )
  })
})
