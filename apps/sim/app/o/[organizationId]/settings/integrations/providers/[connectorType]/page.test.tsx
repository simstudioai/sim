import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }))
vi.mock('@/lib/settings/application/organization-section-access', () => ({
  authorizeOrganizationSettingsSection: mocks.authorize,
}))
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/sim-search/connectors', () => ({
  SEARCH_SOURCE_TYPES: [
    ['jira', { name: 'Jira' }],
    ['confluence', { name: 'Confluence' }],
  ],
}))
vi.mock(
  '@/app/o/[organizationId]/settings/integrations/providers/[connectorType]/provider-detail',
  () => ({ OrganizationProviderDetail: () => null })
)
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: () => null,
}))

import OrganizationProviderPage from '@/app/o/[organizationId]/settings/integrations/providers/[connectorType]/page'

const mockRedirect = nextNavigationMockFns.mockRedirect
const mockGetSession = authMockFns.mockGetSession

beforeEach(() => {
  mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
  mocks.authorize.mockResolvedValue(true)
})

it.each(['jira', 'confluence'])(
  'moves legacy %s Accounts links to filtered People and preserves the search',
  async (connectorType) => {
    await expect(
      OrganizationProviderPage({
        params: Promise.resolve({ organizationId: 'org-1', connectorType }),
        searchParams: Promise.resolve({
          view: 'accounts',
          'credential-group-people': 'alex+qa@example.com',
        }),
      })
    ).rejects.toThrow('NEXT_REDIRECT')
    const url = new URL(mockRedirect.mock.lastCall![0], 'https://example.com')
    expect(url.pathname).toBe('/o/org-1/settings/integrations')
    expect(url.searchParams.get('tab')).toBe('people')
    expect(url.searchParams.get('integration')).toBe(connectorType)
    expect(url.searchParams.get('credential-group-people')).toBe('alex+qa@example.com')
    expect(url.searchParams.has('view')).toBe(false)
  }
)

it('authorizes organization settings before redirecting a legacy link', async () => {
  mocks.authorize.mockResolvedValue(false)
  await expect(
    OrganizationProviderPage({
      params: Promise.resolve({ organizationId: 'org-1', connectorType: 'jira' }),
      searchParams: Promise.resolve({ view: 'accounts' }),
    })
  ).rejects.toThrow('NEXT_NOT_FOUND')
  expect(mockRedirect).not.toHaveBeenCalled()
})

it.each(['jira', ''])(
  'preserves an active setup in a legacy Accounts link (%s)',
  async (addConnector) => {
    await OrganizationProviderPage({
      params: Promise.resolve({ organizationId: 'org-1', connectorType: 'jira' }),
      searchParams: Promise.resolve({ view: 'accounts', addConnector, 'source-access': 'members' }),
    })
    expect(mockRedirect).not.toHaveBeenCalled()
  }
)
