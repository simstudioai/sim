/**
 * @vitest-environment node
 *
 * First paint must never wait on a slow read or seed the wrong answer. Failure modes: a read past
 * its budget holding the document, a failed or malformed read hydrating as if it succeeded, reads
 * for a viewer the routes would refuse, an entry the client hook would not find, and a list whose
 * cached shape differs from what the route sends.
 */
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import type { DehydratedState } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchIntegrationsQueryOptions } from '@/hooks/queries/search-integrations'
import { simLinksQueryOptions } from '@/hooks/queries/sim-links'
import { organizationAccountsKeys } from '@/hooks/queries/utils/organization-accounts-keys'
import { organizationSecretKeys } from '@/hooks/queries/utils/organization-secret-keys'
import { searchHistoryKeys } from '@/hooks/queries/utils/search-history-keys'

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  integrations: vi.fn(),
  history: vi.fn(),
  secretSource: vi.fn(),
  links: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/credential-groups/application/organization-accounts', () => ({
  getOrganizationAccountsSettings: { execute: mocks.accounts },
}))
vi.mock('@/lib/knowledge/application/search-integrations', () => ({
  listSearchIntegrations: { execute: mocks.integrations },
}))
vi.mock('@/lib/knowledge/application/search-history', () => ({
  listSearchHistory: { execute: mocks.history },
}))
vi.mock('@/lib/organization-secrets/application/use-cases', () => ({
  readOrganizationSecretSource: { execute: mocks.secretSource },
}))
vi.mock('@/lib/sim-links/application/use-cases', () => ({
  listSimLinks: { execute: mocks.links },
}))

import { prefetchSearch, prefetchSimLinks } from '@/app/o/[organizationId]/_redesign/prefetch'
import {
  prefetchHome,
  prefetchIntegrations,
} from '@/app/o/[organizationId]/_redesign/prefetch-member-inventory'

const principal = createSessionPrincipal({ userId: 'viewer' })
const surface = (memberScoped: boolean, canConnect = true) => ({
  organization: { id: 'org-1' },
  searchAccess: { memberScoped },
  viewer: { canConnectSearchIntegrations: canConnect },
  connectedAccountsAvailable: true,
})

const seeded = (state: DehydratedState) => state.queries.map((query) => query.queryKey)

const ACCOUNTS_KEY = [...organizationAccountsKeys.detail('org-1')]
const INTEGRATIONS_KEY = [...searchIntegrationsQueryOptions('org-1').queryKey]
const HISTORY_KEY = [...searchHistoryKeys.list('org-1', 'viewer')]
const SECRET_SOURCE_KEY = [...organizationSecretKeys.source('org-1')]

const ACCOUNTS = {
  credentialGroup: null,
  viewerAccounts: [],
  viewerMcpAccounts: [],
  availableProviders: [],
  assistantProviders: [],
  availableMcpConnectors: [],
  canManage: false,
  indexingAvailable: true,
}

const LINK_RECORD = {
  id: 'link-1',
  name: 'handbook',
  normalizedName: 'handbook',
  url: 'https://example.com/handbook',
  defaultUrl: null,
  description: null,
  unlisted: false,
  restrictEdit: false,
  visitCount: 3,
  createdBy: null,
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  canEdit: true,
  canManage: false,
}

beforeEach(() => {
  mocks.accounts.mockResolvedValue(ACCOUNTS)
  mocks.integrations.mockResolvedValue([])
  mocks.history.mockResolvedValue({ sources: [], queries: [] })
  mocks.secretSource.mockResolvedValue({ source: null })
  mocks.links.mockResolvedValue({ links: [LINK_RECORD], nextCursor: 'handbook' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('seeding under the keys the hooks read', () => {
  it('seeds Home', async () => {
    expect(seeded(await prefetchHome(surface(true), principal))).toEqual(
      expect.arrayContaining([ACCOUNTS_KEY, INTEGRATIONS_KEY, HISTORY_KEY])
    )
  })

  it('seeds Search', async () => {
    expect(seeded(await prefetchSearch('org-1', principal))).toEqual([HISTORY_KEY])
  })

  it('seeds Integrations', async () => {
    expect(seeded(await prefetchIntegrations(surface(true), principal))).toEqual(
      expect.arrayContaining([ACCOUNTS_KEY, INTEGRATIONS_KEY, SECRET_SOURCE_KEY])
    )
  })

  it.each([
    [{ search: '', sort: 'name', dir: 'asc' }, ''],
    [{ search: ' handbook ', sort: 'popular', dir: 'desc' }, 'handbook'],
  ] as const)('seeds Links for the list the URL asks for: %j', async (view, term) => {
    expect(seeded(await prefetchSimLinks('org-1', principal, view))).toEqual([
      [...simLinksQueryOptions('org-1', term, view.sort, view.dir).queryKey],
    ])
    expect(mocks.links).toHaveBeenCalledWith({
      principal,
      input: { organizationId: 'org-1', search: term || undefined, sort: view.sort, dir: view.dir },
    })
  })
})

describe('Links first paint', () => {
  it('caches the page as the route sends it, for the hook to page on from', async () => {
    const state = await prefetchSimLinks('org-1', principal, {
      search: '',
      sort: 'name',
      dir: 'asc',
    })
    const { normalizedName, ...wire } = LINK_RECORD
    expect(state.queries[0].state.data).toEqual({
      pages: [
        {
          links: [{ ...wire, updatedAt: '2026-11-01T00:00:00.000Z' }],
          nextCursor: 'handbook',
        },
      ],
      pageParams: [undefined],
    })
  })

  it('leaves a refused list for the client, which reaches the route for the real answer', async () => {
    mocks.links.mockRejectedValue(new Error('Forbidden'))
    const state = await prefetchSimLinks('org-1', principal, {
      search: '',
      sort: 'name',
      dir: 'asc',
    })
    expect(seeded(state)).toEqual([])
  })
})

describe('what stays out of hydration', () => {
  it('reads nothing the routes would refuse this viewer', async () => {
    expect(seeded(await prefetchHome(surface(false), principal))).toEqual([])
    expect(mocks.accounts).not.toHaveBeenCalled()
    expect(mocks.history).not.toHaveBeenCalled()
    expect(seeded(await prefetchHome(surface(true, false), principal))).toEqual([HISTORY_KEY])
    expect(seeded(await prefetchIntegrations(surface(true, false), principal))).toEqual([
      SECRET_SOURCE_KEY,
    ])
    expect(mocks.accounts).not.toHaveBeenCalled()
  })

  it('leaves a failed read for the client and keeps the rest', async () => {
    mocks.accounts.mockRejectedValue(new Error('database unavailable'))
    const keys = seeded(await prefetchHome(surface(true), principal))
    expect(keys).not.toContainEqual(ACCOUNTS_KEY)
    expect(keys).toContainEqual(HISTORY_KEY)
  })

  it('leaves a read outside its contract for the client', async () => {
    mocks.history.mockResolvedValue({ sources: 'not a list', queries: [] })
    expect(seeded(await prefetchSearch('org-1', principal))).toEqual([])
  })

  it('gives up on a slow read rather than hold the document', async () => {
    vi.useFakeTimers()
    mocks.accounts.mockReturnValue(new Promise(() => {}))
    const prefetched = prefetchIntegrations(surface(true), principal)
    await vi.advanceTimersByTimeAsync(2_000)
    const keys = seeded(await prefetched)
    expect(keys).not.toContainEqual(ACCOUNTS_KEY)
    expect(keys).toContainEqual(INTEGRATIONS_KEY)
  })
})
