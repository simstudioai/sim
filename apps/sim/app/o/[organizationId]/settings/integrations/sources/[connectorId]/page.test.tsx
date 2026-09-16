/** @vitest-environment node */
import { Suspense } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  authorize: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/settings/application/organization-section-access', () => ({
  authorizeOrganizationSettingsSection: mocks.authorize,
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }))
vi.mock('@/components/settings/settings-header', () => ({
  SettingsHeaderProvider: 'header-provider',
  SettingsHeaderShell: 'header-shell',
}))
vi.mock(
  '@/app/o/[organizationId]/settings/integrations/sources/[connectorId]/source-detail',
  () => ({ OrganizationSourceDetail: 'source-detail' })
)

import OrganizationSourceLayout from '@/app/o/[organizationId]/settings/integrations/sources/[connectorId]/layout'
import OrganizationSourceLoading from '@/app/o/[organizationId]/settings/integrations/sources/[connectorId]/loading'
import OrganizationSourcePage from '@/app/o/[organizationId]/settings/integrations/sources/[connectorId]/page'

const props = { params: Promise.resolve({ organizationId: 'org-one', connectorId: 'source-one' }) }

describe('organization source page authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'admin-one' } })
    mocks.authorize.mockResolvedValue(true)
    mocks.redirect.mockImplementation(() => {
      throw new Error('redirect')
    })
    mocks.notFound.mockImplementation(() => {
      throw new Error('not found')
    })
  })
  it('gates the source page with the existing target-organization integration policy', async () => {
    const page = await OrganizationSourcePage(props)
    expect(page.type).toBe(Suspense)
    expect(page.props.fallback.type).toBe(OrganizationSourceLoading)
    expect(mocks.authorize).toHaveBeenCalledWith({
      organizationId: 'org-one',
      userId: 'admin-one',
      section: 'integrations',
    })
  })
  it('renders the persistent heading without waiting for page authorization', () => {
    const layout = OrganizationSourceLayout({ children: <OrganizationSourceLoading /> })
    expect(layout.type).toBe('header-provider')
    expect(layout.props.children).toMatchObject({
      type: 'header-shell',
      props: { meta: { title: 'Search source' } },
    })
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.authorize).not.toHaveBeenCalled()
  })
  it('does not render when the admin or feature gate denies access', async () => {
    mocks.authorize.mockResolvedValue(false)
    await expect(OrganizationSourcePage(props)).rejects.toThrow('not found')
  })
  it('returns signed-out users to the requested source after login', async () => {
    mocks.session.mockResolvedValue(null)
    await expect(OrganizationSourcePage(props)).rejects.toThrow('redirect')
    const url = new URL(mocks.redirect.mock.calls[0][0], 'https://example.com')
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('callbackUrl')).toBe(
      '/o/org-one/settings/integrations/sources/source-one'
    )
    expect(mocks.authorize).not.toHaveBeenCalled()
  })
})
