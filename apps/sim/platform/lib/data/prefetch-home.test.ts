/**
 * @vitest-environment node
 *
 * First paint must never wait on a slow read or seed the wrong answer. Failure modes: a read past
 * its budget holding the document, a failed or malformed read hydrating as if it succeeded, reads
 * for a viewer the routes would refuse, and an entry the client hook would not find.
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchHistoryKeys } from '@/hooks/queries/search-history'
import { organizationAccountsKeys } from '@/hooks/queries/utils/organization-accounts-keys'
import { searchIntegrationKeys } from '@/hooks/queries/utils/search-integration-keys'

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  integrations: vi.fn(),
  history: vi.fn(),
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

import { prefetchHome } from '@/platform/lib/data/prefetch-home'

const principal: SessionPrincipal = { kind: 'session', userId: 'viewer', sessionId: 'session' }
const surface = (memberScoped: boolean, canConnect = true) => ({
  organization: { id: 'org-1' },
  searchAccess: { memberScoped },
  viewer: { canConnectSearchIntegrations: canConnect },
  connectedAccountsAvailable: true,
})

const seeded = (state: Awaited<ReturnType<typeof prefetchHome>>) =>
  state.queries.map((query) => query.queryKey)

const ACCOUNTS = {
  credentialGroup: null,
  availableProviders: [],
  assistantProviders: [],
  availableMcpConnectors: [],
  canManage: false,
  indexingAvailable: true,
}

beforeEach(() => {
  mocks.accounts.mockResolvedValue(ACCOUNTS)
  mocks.integrations.mockResolvedValue([])
  mocks.history.mockResolvedValue({ sources: [], queries: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('prefetching Home', () => {
  it('seeds each read under the key its client hook reads', async () => {
    expect(seeded(await prefetchHome(surface(true), principal))).toEqual(
      expect.arrayContaining([
        [...organizationAccountsKeys.detail('org-1')],
        [...searchIntegrationKeys.list('org-1')],
        [...searchHistoryKeys.list('org-1', 'viewer')],
      ])
    )
  })

  it('reads nothing the routes would refuse this viewer', async () => {
    expect(seeded(await prefetchHome(surface(false, false), principal))).toEqual([])
    expect(mocks.accounts).not.toHaveBeenCalled()
    expect(mocks.history).not.toHaveBeenCalled()
  })

  it('leaves a failed read for the client and keeps the rest', async () => {
    mocks.accounts.mockRejectedValue(new Error('database unavailable'))
    const keys = seeded(await prefetchHome(surface(true), principal))
    expect(keys).not.toContainEqual([...organizationAccountsKeys.detail('org-1')])
    expect(keys).toContainEqual([...searchHistoryKeys.list('org-1', 'viewer')])
  })

  it('leaves a read outside its contract for the client', async () => {
    mocks.history.mockResolvedValue({ sources: 'not a list', queries: [] })
    expect(seeded(await prefetchHome(surface(true), principal))).not.toContainEqual([
      ...searchHistoryKeys.list('org-1', 'viewer'),
    ])
  })

  it('gives up on a slow read rather than hold the document', async () => {
    vi.useFakeTimers()
    mocks.accounts.mockReturnValue(new Promise(() => {}))
    const prefetched = prefetchHome(surface(true), principal)
    await vi.advanceTimersByTimeAsync(2_000)
    const keys = seeded(await prefetched)
    expect(keys).not.toContainEqual([...organizationAccountsKeys.detail('org-1')])
    expect(keys).toContainEqual([...searchIntegrationKeys.list('org-1')])
  })
})
