/** @vitest-environment node */
import { authMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { redirect, organizationContext } = vi.hoisted(() => ({
  redirect: vi.fn(),
  organizationContext: vi.fn(),
}))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/organizations/surface', () => ({
  getOrganizationSurfaceContext: organizationContext,
}))
vi.mock('@/ee/access-requests/components/my-access-requests', () => ({
  MyAccessRequests: () => null,
}))
vi.mock('@/ee/access-requests/components/organization-access-requests', () => ({
  OrganizationAccessRequests: () => null,
}))

import AccessRequestsPage from '@/app/access-requests/page'
import { MyAccessRequests } from '@/ee/access-requests/components/my-access-requests'

describe('access request sign-in redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(destination.pathname).toBe('/o/organization/access-requests')
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
        searchParams: Promise.resolve({ organizationId: 'organization' }),
      })
      expect(redirect).not.toHaveBeenCalled()
    }
  )

  it('keeps authenticated administrator email links on the review surface', async () => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'viewer' } })
    await AccessRequestsPage({
      searchParams: Promise.resolve({
        organizationId: 'organization',
        view: 'admin',
        requestId: 'request',
      }),
    })
    expect(redirect).not.toHaveBeenCalled()
    expect(organizationContext).not.toHaveBeenCalled()
  })

  it('renders the standalone requester when the optional organization navigation lookup fails', async () => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'viewer' } })
    organizationContext.mockRejectedValue(new Error('Organization context unavailable'))

    const page = await AccessRequestsPage({
      searchParams: Promise.resolve({ organizationId: 'organization', requestId: 'request' }),
    })

    expect(redirect).not.toHaveBeenCalled()
    expect(page.props.children.type).toBe(MyAccessRequests)
    expect(page.props.children.props).toEqual({
      scope: { kind: 'organization', organizationId: 'organization' },
      standalone: true,
    })
  })
})
