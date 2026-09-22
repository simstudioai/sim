/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ session: vi.fn(), authorize: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Error(`redirect:${href}`)
  },
  notFound: () => {
    throw new Error('not-found')
  },
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
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

describe('organization request settings routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'viewer' } })
    mocks.authorize.mockResolvedValue(true)
  })

  it('renders the canonical request section only through the shared organization gate', async () => {
    const page = await OrganizationSettingsSectionPage({
      params: Promise.resolve({ organizationId: 'organization', section: 'requests' }),
    })
    expect(page.props.section).toBe('requests')
    expect(mocks.authorize).toHaveBeenCalledWith({
      organizationId: 'organization',
      userId: 'viewer',
      section: 'requests',
    })
  })

  it('authorizes saved review tabs as Requests and preserves their selected request', async () => {
    await expect(
      OrganizationSettingsSectionPage({
        params: Promise.resolve({ organizationId: 'organization', section: 'access-control' }),
        searchParams: Promise.resolve({
          'access-view': 'requests',
          'request-id': 'selected',
          'request-status': 'all',
          'group-id': 'old-group',
        }),
      })
    ).rejects.toThrow(
      'redirect:/o/organization/settings/requests?request-id=selected&request-status=all'
    )
    expect(mocks.authorize).toHaveBeenCalledWith({
      organizationId: 'organization',
      userId: 'viewer',
      section: 'requests',
    })
  })

  it('conceals requests from viewers rejected by the organization gate', async () => {
    mocks.authorize.mockResolvedValue(false)
    await expect(
      OrganizationSettingsSectionPage({
        params: Promise.resolve({ organizationId: 'organization', section: 'access-control' }),
        searchParams: Promise.resolve({ 'access-view': 'requests' }),
      })
    ).rejects.toThrow('not-found')
  })
})
