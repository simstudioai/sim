/**
 * @vitest-environment jsdom
 *
 * A warmer is a guess that a click is coming, so a wrong guess must cost nothing. Failure modes: a
 * read for a pointer only passing over a row, a read the viewer's page would refuse, and a warm read
 * under a key the page does not look at.
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchIntegrationsQueryOptions } from '@/hooks/queries/search-integrations'
import { organizationAccountsKeys } from '@/hooks/queries/utils/organization-accounts-keys'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'

const { surface } = vi.hoisted(() => ({
  surface: {
    organization: { id: 'org-1' },
    routePrefix: '/o/org-1',
    searchAccess: { memberScoped: true },
    viewer: { isAdmin: false, canConnectSearchIntegrations: true },
    connectedAccountsAvailable: true,
    navFlags: { simLinks: true },
  },
}))

vi.mock('@/platform/lib/data/organization', () => ({ useOrganization: () => surface }))

import { useNavWarmers } from '@/platform/lib/data/nav-warmers'

const mounted: Root[] = []
const router = {
  bfcacheId: 'test',
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}
let queryClient: QueryClient
let reads: unknown[]

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
      <AppRouterContext.Provider value={router}>
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      </AppRouterContext.Provider>
    )
  )
  if (!warmers) throw new Error('The probe did not render')
  return warmers
}

const readKeys = () => reads.map((key) => JSON.stringify(key))

async function settleDwell() {
  await act(() => vi.advanceTimersByTimeAsync(100))
}

beforeEach(() => {
  vi.useFakeTimers()
  queryClient = new QueryClient()
  reads = []
  const record = async ({ queryKey }: { queryKey: unknown }) => {
    reads.push(queryKey)
  }
  vi.spyOn(queryClient, 'prefetchQuery').mockImplementation(record as never)
  vi.spyOn(queryClient, 'prefetchInfiniteQuery').mockImplementation(record as never)
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
    expect(reads).toEqual([])
  })

  it('reads Integrations under the keys its page reads after a dwell', async () => {
    const warmers = renderWarmers()
    warmers.schedule('integrations')
    await settleDwell()
    expect(readKeys()).toEqual(
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
    expect(reads).toEqual([])
  })

  it('warms a Settings section’s route and roster, and seats only for an admin', async () => {
    const warmers = renderWarmers()
    warmers.warmSettings('members')
    await settleDwell()
    expect(router.prefetch).toHaveBeenCalledWith('/o/org-1/settings/members')
    expect(readKeys()).toContain(JSON.stringify(organizationKeys.roster('org-1')))
    expect(readKeys()).not.toContain(JSON.stringify(organizationKeys.planSeats('org-1')))
    surface.viewer.isAdmin = true
    renderWarmers().warmSettings('members')
    await settleDwell()
    expect(readKeys()).toContain(JSON.stringify(organizationKeys.planSeats('org-1')))
  })
})
