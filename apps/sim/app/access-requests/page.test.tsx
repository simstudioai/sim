/** @vitest-environment node */
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
import { AccessRequestsSettings } from '@/ee/access-requests/components/access-requests-settings'

describe('access request sign-in redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    organizationAccess.mockResolvedValue({ isAdmin: false, isMember: true })
    authMockFns.mockGetSession.mockResolvedValue(null)
    redirect.mockImplementation(() => {
      throw new Error('Redirect')
    })
  })

  it.each([
    {
      organizationId: 'organization',
      view: 'catalog',
      requestId: 'request',
      search: 'Slack & Notion',
      page: '3',
    },
    {
      organizationId: 'organization',
      view: 'admin',
      requestId: 'request',
      'request-status': 'declined',
      'request-page': '2',
    },
  ])('preserves the supported $view state through sign-in', async (params) => {
    await expect(AccessRequestsPage({ searchParams: Promise.resolve(params) })).rejects.toThrow(
      'Redirect'
    )
    const loginUrl = new URL(redirect.mock.calls[0][0], 'https://example.com')
    expect(loginUrl.pathname).toBe('/login')
    const callback = new URL(loginUrl.searchParams.get('callbackUrl')!, loginUrl.origin)
    expect(callback.pathname).toBe('/access-requests')
    expect(Object.fromEntries(callback.searchParams)).toEqual(params)
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

  it('opens saved requester links in the organization shell with their filters and selection', async () => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'viewer' } })
    organizationContext.mockResolvedValue({ searchAccess: { memberScoped: true } })
    await expect(
      AccessRequestsPage({
        searchParams: Promise.resolve({
          organizationId: 'organization',
          view: 'catalog',
          requestId: 'request/a',
          search: 'Slack & Notion',
          page: '3',
          callbackUrl: 'https://example.com/untrusted',
        }),
      })
    ).rejects.toThrow('Redirect')
    expect(organizationContext).toHaveBeenCalledWith('organization', 'viewer')
    const destination = new URL(redirect.mock.calls[0][0], 'https://example.com')
    expect(destination.pathname).toBe('/o/organization/settings/requests')
    expect(Object.fromEntries(destination.searchParams)).toEqual({
      view: 'catalog',
      requestId: 'request/a',
      search: 'Slack & Notion',
      page: '3',
    })
  })

  it.each([null, { searchAccess: { memberScoped: false } }])(
    'keeps the standalone route when the organization surface is unavailable: %j',
    async (context) => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'viewer' } })
      organizationContext.mockResolvedValue(context)
      await AccessRequestsPage({
        searchParams: Promise.resolve({ organizationId: 'organization', view: 'requests' }),
      })
      expect(redirect).not.toHaveBeenCalled()
    }
  )

  it('normalizes saved administrator email links without losing review state', async () => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'viewer' } })
    await expect(
      AccessRequestsPage({
        searchParams: Promise.resolve({
          organizationId: 'organization',
          view: 'admin',
          requestId: 'request',
          'request-status': 'declined',
        }),
      })
    ).rejects.toThrow('Redirect')
    const destination = new URL(redirect.mock.calls[0][0], 'https://example.com')
    expect(Object.fromEntries(destination.searchParams)).toEqual({
      organizationId: 'organization',
      view: 'review',
      'request-id': 'request',
      'request-status': 'declined',
    })
    expect(organizationContext).not.toHaveBeenCalled()
  })

  it('routes reviewer links into organization settings when the shell is available', async () => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'viewer' } })
    organizationContext.mockResolvedValue({ searchAccess: { memberScoped: true } })
    await expect(
      AccessRequestsPage({
        searchParams: Promise.resolve({
          organizationId: 'organization',
          view: 'review',
          'request-id': 'request',
        }),
      })
    ).rejects.toThrow('Redirect')
    expect(redirect).toHaveBeenCalledWith(
      '/o/organization/settings/requests?request-id=request&view=review'
    )
  })

  it.each([undefined, 'invalid', ['requests', 'review']])(
    'keeps invalid or old requester links on My requests: %j',
    async (view) => {
      authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'viewer' } })
      await expect(
        AccessRequestsPage({
          searchParams: Promise.resolve({
            organizationId: 'organization',
            requestId: 'request',
            view,
          }),
        })
      ).rejects.toThrow('Redirect')
      const destination = new URL(redirect.mock.calls[0][0], 'https://example.com')
      expect(destination.searchParams.get('view')).toBe('requests')
      expect(destination.searchParams.get('requestId')).toBe('request')
    }
  )

  it('renders the standalone requester when the optional organization navigation lookup fails', async () => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'viewer' } })
    organizationContext.mockRejectedValue(new Error('Organization context unavailable'))

    const page = await AccessRequestsPage({
      searchParams: Promise.resolve({
        organizationId: 'organization',
        view: 'requests',
        requestId: 'request',
      }),
    })

    expect(redirect).not.toHaveBeenCalled()
    expect(page.props.children.props.children.props.children.props.children.type).toBe(
      AccessRequestsSettings
    )
    expect(page.props.children.props.children.props.children.props.children.props).toEqual({
      scope: { kind: 'organization', organizationId: 'organization' },
      standalone: true,
      reviewOrganizationId: undefined,
    })
  })
})
