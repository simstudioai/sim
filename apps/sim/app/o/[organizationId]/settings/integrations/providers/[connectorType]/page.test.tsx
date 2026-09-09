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
vi.mock('@/lib/sim-search/connectors', () => ({
  SEARCH_SOURCE_TYPES: [['google_drive', { name: 'Google Drive' }]],
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }))
vi.mock('@/components/settings/settings-header', () => ({
  SettingsHeaderProvider: 'header-provider',
  SettingsHeaderShell: 'header-shell',
}))
vi.mock(
  '@/app/o/[organizationId]/settings/integrations/providers/[connectorType]/provider-detail',
  () => ({ OrganizationProviderDetail: 'provider-detail' })
)

import OrganizationProviderLayout from '@/app/o/[organizationId]/settings/integrations/providers/[connectorType]/layout'
import OrganizationProviderPage, {
  generateMetadata,
} from '@/app/o/[organizationId]/settings/integrations/providers/[connectorType]/page'

const props = {
  params: Promise.resolve({ organizationId: 'org-one', connectorType: 'google_drive' }),
}

describe('organization provider page authorization', () => {
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

  it('checks the target organization integration policy before rendering provider management', async () => {
    const page = await OrganizationProviderPage(props)
    expect(mocks.authorize).toHaveBeenCalledWith({
      organizationId: 'org-one',
      userId: 'admin-one',
      section: 'integrations',
    })
    expect(page.type).toBe(Suspense)
    expect(page.props.children).toMatchObject({
      type: 'provider-detail',
      props: { connectorType: 'google_drive' },
    })
  })

  it('rejects unknown or unsupported providers before loading protected organization state', async () => {
    await expect(
      OrganizationProviderPage({
        params: Promise.resolve({ organizationId: 'org-one', connectorType: 'unknown-provider' }),
      })
    ).rejects.toThrow('not found')
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('does not render when the admin or feature gate denies access', async () => {
    mocks.authorize.mockResolvedValue(false)
    await expect(OrganizationProviderPage(props)).rejects.toThrow('not found')
  })

  it('returns signed-out users to the requested provider after login', async () => {
    mocks.session.mockResolvedValue(null)
    await expect(OrganizationProviderPage(props)).rejects.toThrow('redirect')
    const url = new URL(mocks.redirect.mock.calls[0][0], 'https://example.com')
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('callbackUrl')).toBe(
      '/o/org-one/settings/integrations/providers/google_drive'
    )
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('keeps the settings header mounted independently of provider authorization', () => {
    const layout = OrganizationProviderLayout({ children: <span>Loading integration</span> })
    expect(layout.type).toBe('header-provider')
    expect(layout.props.children).toMatchObject({
      type: 'header-shell',
      props: { meta: { title: 'Integration' } },
    })
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('uses the supported provider name as page metadata', async () => {
    expect(await generateMetadata(props)).toEqual({ title: 'Google Drive' })
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.authorize).not.toHaveBeenCalled()
  })
})
