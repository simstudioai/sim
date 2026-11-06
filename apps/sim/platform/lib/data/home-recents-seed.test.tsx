/**
 * @vitest-environment jsdom
 *
 * What the server seeds is only worth its read if the client finds it. Failure mode: Recents keyed by
 * one identity on the server and another on the client, which paints loading and reads again.
 */

import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import {
  organizationProviderMock,
  organizationProviderMockFns,
} from '@sim/testing/mocks/organization-provider.mock'
import { hydrate, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ history: vi.fn(), accounts: vi.fn(), integrations: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => organizationProviderMock)
vi.mock('@/app/workspace/[workspaceId]/providers/feature-flags-provider', () => ({
  useFeatureFlag: () => false,
}))
vi.mock('@/lib/knowledge/application/search-history', () => ({
  listSearchHistory: { execute: mocks.history },
}))
vi.mock('@/lib/credential-groups/application/organization-accounts', () => ({
  getOrganizationAccountsSettings: { execute: mocks.accounts },
}))
vi.mock('@/lib/knowledge/application/search-integrations', () => ({
  listSearchIntegrations: { execute: mocks.integrations },
}))
vi.mock('@/platform/lib/data/integrations', () => ({
  useIntegrationActions: () => ({
    connecting: false,
    connect: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
  }),
}))

import { useLiveHome } from '@/platform/lib/data/home'
import { prefetchHome } from '@/platform/lib/data/prefetch-member-inventory'
import { renderDataHook, unmountDataHooks } from '@/platform/lib/render-hook.test-support'

const HISTORY_PATH = '/api/organizations/[id]/search/history'

const SURFACE = {
  organization: { id: 'org-1', name: 'Org', logo: null },
  viewer: {
    userId: 'user-1',
    isAdmin: false,
    canConnectSearchIntegrations: false,
    canUseSearchMcp: false,
  },
  searchAccess: { memberScoped: true },
  connectedAccountsAvailable: true,
  settingsFeatures: { hosted: true, billingEnabled: true },
}

const SOURCE = {
  url: 'https://example.com/handbook',
  title: 'Handbook',
  viewedAt: '2026-11-05T12:00:00.000Z',
}

describe('Recents seeded by prefetchHome', () => {
  afterEach(unmountDataHooks)

  it('paints from the seed on the first render, with no read and no session', async () => {
    mocks.history.mockResolvedValue({ sources: [SOURCE], queries: [] })
    organizationProviderMockFns.mockUseOrganizationContext.mockReturnValue(SURFACE)
    authClientMockFns.mockUseSession.mockReturnValue({ data: null, isPending: true })
    apiClientRequestMockFns.mockRequestJson.mockImplementation(() => new Promise(() => {}))

    const state = await prefetchHome(
      SURFACE as never,
      createSessionPrincipal({ userId: SURFACE.viewer.userId })
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    hydrate(queryClient, state)

    const paints: ReturnType<typeof useLiveHome>[] = []
    await renderDataHook(
      () => {
        const home = useLiveHome(false)
        paints.push(home)
        return home
      },
      { queryClient }
    )

    expect(paints[0].view.recents).toMatchObject({
      status: 'ready',
      items: [expect.objectContaining({ label: 'Handbook' })],
    })
    const paths = apiClientRequestMockFns.mockRequestJson.mock.calls.map(
      ([contract]) => contract.path
    )
    expect(paths).not.toContain(HISTORY_PATH)
  })
})
