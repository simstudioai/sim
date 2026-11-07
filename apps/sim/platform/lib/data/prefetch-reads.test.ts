/**
 * @vitest-environment node
 *
 * A first-paint read is only worth its seat if the client finds it, and may never cost the page.
 * Failure modes: an entry under a key the hook does not read, a read for a viewer the route would
 * refuse, a failed read hydrating as success or taking its neighbours down, and a Links list whose
 * URL or cached shape differs from what the page's infinite query reads.
 */
import type { DehydratedState } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listSearchHistoryContract } from '@/lib/api/contracts/knowledge/search-history'
import { listSearchIntegrationsContract } from '@/lib/api/contracts/knowledge/search-integrations'
import { getOrganizationAccountsContract } from '@/lib/api/contracts/organization-accounts'
import { listSimLinksContract } from '@/lib/api/contracts/sim-links'
import { getUserProfileContract } from '@/lib/api/contracts/user'
import { searchIntegrationsQueryOptions } from '@/hooks/queries/search-integrations'
import { simLinksQueryOptions } from '@/hooks/queries/sim-links'
import { organizationAccountsKeys } from '@/hooks/queries/utils/organization-accounts-keys'
import { searchHistoryKeys } from '@/hooks/queries/utils/search-history-keys'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

const { prefetchRequestJson } = vi.hoisted(() => ({ prefetchRequestJson: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/platform/lib/data/server-request', () => ({ prefetchRequestJson }))

import { prefetchHome } from '@/platform/lib/data/prefetch-home'
import { prefetchIntegrations } from '@/platform/lib/data/prefetch-integrations'
import { prefetchSearch } from '@/platform/lib/data/prefetch-search'
import { prefetchSimLinks } from '@/platform/lib/data/prefetch-sim-links'

function organization(memberScoped = true, canConnect = true) {
  return {
    organization: { id: 'org-1' },
    searchAccess: { memberScoped },
    viewer: { canConnectSearchIntegrations: canConnect },
    connectedAccountsAvailable: true,
    // double-cast-allowed: only the fields these reads gate on matter to what they seed
  } as unknown as PlatformOrganization
}

const ACCOUNTS_KEY = [...organizationAccountsKeys.detail('org-1')]
const INTEGRATIONS_KEY = [...searchIntegrationsQueryOptions('org-1').queryKey]
const HISTORY_KEY = [...searchHistoryKeys.list('org-1', 'viewer')]

const seeded = (state: DehydratedState) => state.queries.map(({ queryKey }) => queryKey)

beforeEach(() => {
  prefetchRequestJson.mockImplementation(async (contract: unknown) => {
    if (contract === getUserProfileContract) return { user: { id: 'viewer' } }
    if (contract === listSearchHistoryContract) return { sources: [], queries: [] }
    if (contract === listSearchIntegrationsContract) return { data: [] }
    if (contract === getOrganizationAccountsContract) return { viewerAccounts: [] }
    if (contract === listSimLinksContract) return { links: [], nextCursor: 'next' }
    throw new Error('unexpected read')
  })
})

describe('seeding under the keys the hooks read', () => {
  it('seeds Home with the inventory and the recents', async () => {
    const keys = seeded(await prefetchHome(organization()))
    expect(keys).toHaveLength(3)
    expect(keys).toEqual(expect.arrayContaining([ACCOUNTS_KEY, INTEGRATIONS_KEY, HISTORY_KEY]))
  })

  it('seeds Search with the history', async () => {
    expect(seeded(await prefetchSearch(organization()))).toEqual([HISTORY_KEY])
  })

  it('seeds Integrations with the inventory', async () => {
    const keys = seeded(await prefetchIntegrations(organization()))
    expect(keys).toHaveLength(2)
    expect(keys).toEqual(expect.arrayContaining([ACCOUNTS_KEY, INTEGRATIONS_KEY]))
  })

  it('unwraps the policies the way the hook does', async () => {
    const state = await prefetchIntegrations(organization())
    const policies = state.queries.find(
      ({ queryKey }) => JSON.stringify(queryKey) === JSON.stringify(INTEGRATIONS_KEY)
    )
    expect(policies?.state.data).toEqual([])
  })
})

describe('Links', () => {
  it('reads and keys the list this URL asks for, in the infinite query shape', async () => {
    const state = await prefetchSimLinks('org-1', { search: ' hand ', sort: 'popular', dir: 'asc' })
    expect(seeded(state)).toEqual([
      [...simLinksQueryOptions('org-1', 'hand', 'popular', 'asc').queryKey],
    ])
    expect(prefetchRequestJson).toHaveBeenLastCalledWith(listSimLinksContract, {
      params: { id: 'org-1' },
      query: { search: 'hand', sort: 'popular', dir: 'asc' },
    })
    expect(state.queries[0]?.state.data).toEqual({
      pages: [{ links: [], nextCursor: 'next' }],
      pageParams: [undefined],
    })
  })

  it('omits an empty search and falls to the default order on a bare URL', async () => {
    const state = await prefetchSimLinks('org-1', {})
    const { search, sort, dir } = prefetchRequestJson.mock.calls.at(-1)?.[1].query ?? {}
    expect(search).toBeUndefined()
    expect(seeded(state)).toEqual([[...simLinksQueryOptions('org-1', '', sort, dir).queryKey]])
  })
})

describe('a viewer the route would refuse', () => {
  it('reads nothing without member-scoped Search', async () => {
    prefetchRequestJson.mockClear()
    expect(seeded(await prefetchHome(organization(false)))).toEqual([])
    expect(seeded(await prefetchSearch(organization(false)))).toEqual([])
    expect(seeded(await prefetchIntegrations(organization(false)))).toEqual([])
    expect(prefetchRequestJson).not.toHaveBeenCalled()
  })

  it('keeps the recents but not the inventory for one who cannot connect', async () => {
    expect(seeded(await prefetchHome(organization(true, false)))).toEqual([HISTORY_KEY])
  })
})

describe('a failed read', () => {
  it('stays out of hydration for the client and leaves its neighbours seeded', async () => {
    prefetchRequestJson.mockImplementation(async (contract: unknown) => {
      if (contract === getUserProfileContract) return { user: { id: 'viewer' } }
      if (contract === listSearchHistoryContract) throw new Error('budget spent')
      if (contract === listSearchIntegrationsContract) return { data: [] }
      return { viewerAccounts: [] }
    })
    const keys = seeded(await prefetchHome(organization()))
    expect(keys).not.toContainEqual(HISTORY_KEY)
    expect(keys).toEqual(expect.arrayContaining([ACCOUNTS_KEY, INTEGRATIONS_KEY]))
  })

  it('skips the history when the viewer cannot be named, rather than keying it to nobody', async () => {
    prefetchRequestJson.mockImplementation(async (contract: unknown) => {
      if (contract === getUserProfileContract) throw new Error('budget spent')
      throw new Error('unexpected read')
    })
    expect(seeded(await prefetchSearch(organization()))).toEqual([])
    expect(prefetchRequestJson).not.toHaveBeenCalledWith(
      listSearchHistoryContract,
      expect.anything()
    )
  })

  it('never fails the page', async () => {
    prefetchRequestJson.mockRejectedValue(new Error('down'))
    await expect(prefetchSimLinks('org-1', {})).resolves.toMatchObject({ queries: [] })
    await expect(prefetchSearch(organization())).resolves.toMatchObject({ queries: [] })
  })
})
