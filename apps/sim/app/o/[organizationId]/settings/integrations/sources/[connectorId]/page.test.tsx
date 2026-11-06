import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
}))
vi.mock('@/lib/settings/application/organization-section-access', () => ({
  authorizeOrganizationSettingsSection: mocks.authorize,
}))
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock(
  '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/source-detail',
  () => ({
    SourceDetail: 'source-detail',
  })
)
vi.mock('@/platform/embedded/app/(shell)/settings/_components/settings-subpage-host', () => ({
  SettingsSubpageHost: 'settings-subpage-host',
}))

import OrganizationSourcePage from '@/app/o/[organizationId]/settings/integrations/sources/[connectorId]/page'

const mockRedirect = nextNavigationMockFns.mockRedirect
const mockGetSession = authMockFns.mockGetSession

const props = createRouteContext({ organizationId: 'org-one', connectorId: 'source-one' })

describe('organization source page authorization', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ user: { id: 'admin-one' } })
    mocks.authorize.mockResolvedValue(true)
  })
  it('gates the source page with the existing target-organization integration policy', async () => {
    await OrganizationSourcePage(props)
    expect(mocks.authorize).toHaveBeenCalledWith({
      organizationId: 'org-one',
      userId: 'admin-one',
      section: 'integrations',
    })
  })
  it('does not render when the admin or feature gate denies access', async () => {
    mocks.authorize.mockResolvedValue(false)
    await expect(OrganizationSourcePage(props)).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('returns signed-out users to the requested source after login', async () => {
    mockGetSession.mockResolvedValue(null)
    await expect(OrganizationSourcePage(props)).rejects.toThrow('NEXT_REDIRECT')
    const url = new URL(mockRedirect.mock.calls[0][0], 'https://example.com')
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('callbackUrl')).toBe(
      '/o/org-one/settings/integrations/sources/source-one'
    )
    expect(mocks.authorize).not.toHaveBeenCalled()
  })
})
