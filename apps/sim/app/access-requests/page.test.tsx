/** @vitest-environment node */
import { authMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/ee/access-requests/components/my-access-requests', () => ({
  MyAccessRequests: () => null,
}))
vi.mock('@/ee/access-requests/components/organization-access-requests', () => ({
  OrganizationAccessRequests: () => null,
}))

import AccessRequestsPage from '@/app/access-requests/page'

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
})
