/**
 * @vitest-environment jsdom
 *
 * A warmer is a guess that a click is coming, so a wrong guess must cost nothing. Failure modes: a
 * read for a pointer only passing over a row, a read the viewer's page would refuse, and a warm read
 * under a key the page does not look at.
 */
import { act } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchIntegrationsQueryOptions } from '@/hooks/queries/search-integrations'
import { organizationAccountsKeys } from '@/hooks/queries/utils/organization-accounts-keys'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'

const { surface } = vi.hoisted(() => ({
  surface: {
    organization: { id: 'org-1' },
    routePrefix: '',
    searchAccess: { memberScoped: true },
    viewer: { isAdmin: false, canConnectSearchIntegrations: true },
    connectedAccountsAvailable: true,
    navFlags: { simLinks: true },
  },
}))

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/platform/lib/data/organization', () => ({ useOrganization: () => surface }))
vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

import { useNavWarmers } from '@/platform/lib/data/nav-warmers'

const mounted: Root[] = []
let queryClient: QueryClient

function renderWarmers() {
  const root = createRoot(document.createElement('div'))
  mounted.push(root)
  let warmers: ReturnType<typeof useNavWarmers> | undefined
  function Probe() {
    warmers = useNavWarmers()
    return null
  }
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    )
  )
  if (!warmers) throw new Error('The probe did not render')
  return warmers
}

const cachedKeys = () =>
  queryClient
    .getQueryCache()
    .getAll()
    .map(({ queryKey }) => JSON.stringify(queryKey))

async function settleDwell() {
  await act(() => vi.advanceTimersByTimeAsync(100))
}

beforeEach(() => {
  vi.useFakeTimers()
  queryClient = new QueryClient()
  apiClientRequestMockFns.mockRequestJson.mockReset()
  apiClientRequestMockFns.mockRequestJson.mockResolvedValue({
    data: [],
    links: [],
    nextCursor: null,
  })
  surface.viewer.isAdmin = false
  surface.viewer.canConnectSearchIntegrations = true
  surface.navFlags.simLinks = true
})

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  vi.useRealTimers()
})

describe('warming a nav row', () => {
  it('reads nothing for a pointer passing over', async () => {
    const warmers = renderWarmers()
    warmers.schedule('integrations')
    warmers.cancel()
    await settleDwell()
    expect(apiClientRequestMockFns.mockRequestJson).not.toHaveBeenCalled()
  })

  it('reads Integrations under the keys its page reads after a dwell', async () => {
    const warmers = renderWarmers()
    warmers.schedule('integrations')
    await settleDwell()
    expect(cachedKeys()).toEqual(
      expect.arrayContaining([
        JSON.stringify(organizationAccountsKeys.detail('org-1')),
        JSON.stringify(searchIntegrationsQueryOptions('org-1').queryKey),
      ])
    )
  })

  it('leaves alone what the viewer’s page would refuse', async () => {
    surface.viewer.canConnectSearchIntegrations = false
    surface.navFlags.simLinks = false
    const warmers = renderWarmers()
    for (const destination of ['integrations', 'people', 'links']) {
      warmers.schedule(destination)
      await settleDwell()
    }
    expect(apiClientRequestMockFns.mockRequestJson).not.toHaveBeenCalled()
  })

  it('warms a Settings section’s route and roster, and seats only for an admin', async () => {
    const warmers = renderWarmers()
    warmers.warmSettings('members')
    await settleDwell()
    expect(nextNavigationMockFns.router.prefetch).toHaveBeenCalledWith('/settings/members')
    expect(cachedKeys()).toContain(JSON.stringify(organizationKeys.roster('org-1')))
    expect(cachedKeys()).not.toContain(JSON.stringify(organizationKeys.planSeats('org-1')))
    surface.viewer.isAdmin = true
    renderWarmers().warmSettings('members')
    await settleDwell()
    expect(cachedKeys()).toContain(JSON.stringify(organizationKeys.planSeats('org-1')))
  })
})
