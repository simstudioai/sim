/**
 * @vitest-environment node
 *
 * A first-paint read is only worth its seat if the client finds it, and may never cost the page.
 * Failure modes: an entry under a key the hook does not read, a read for a viewer the route would
 * refuse, a failed read or one outside its route contract hydrating as success or taking its
 * neighbours down, a slow read holding the shell past its budget, a Links list whose input or
 * cached shape differs from what the page's infinite query reads, and a seeded session that carries
 * the session token (or any other server-only field) into the page or ages from the wrong time.
 */
import type { DehydratedState } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession } from '@/lib/auth'
import { searchIntegrationsQueryOptions } from '@/hooks/queries/search-integrations'
import { simLinksQueryOptions } from '@/hooks/queries/sim-links'
import { organizationAccountsKeys } from '@/hooks/queries/utils/organization-accounts-keys'
import { organizationSecretKeys } from '@/hooks/queries/utils/organization-secret-keys'
import { searchHistoryKeys } from '@/hooks/queries/utils/search-history-keys'
import { sessionKeys } from '@/hooks/queries/utils/session-keys'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  integrations: vi.fn(),
  history: vi.fn(),
  links: vi.fn(),
  workspaces: vi.fn(),
  profile: vi.fn(),
  settings: vi.fn(),
  secretSource: vi.fn(),
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
vi.mock('@/lib/sim-links/application/use-cases', () => ({
  listSimLinks: { execute: mocks.links },
}))
vi.mock('@/lib/organization-secrets/application/use-cases', () => ({
  readOrganizationSecretSource: { execute: mocks.secretSource },
}))
vi.mock('@/lib/workspaces/list', () => ({ listWorkspacesForViewer: mocks.workspaces }))
vi.mock('@/lib/users/application/read-current-user', () => ({
  getCurrentUserProfileUseCase: { execute: mocks.profile },
  getCurrentUserSettingsUseCase: { execute: mocks.settings },
}))

import { prefetchHome } from '@/platform/lib/data/prefetch-home'
import { prefetchIntegrations } from '@/platform/lib/data/prefetch-integrations'
import { prefetchSearch } from '@/platform/lib/data/prefetch-search'
import { prefetchShell } from '@/platform/lib/data/prefetch-shell'
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

const LINK = {
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

const ACCOUNTS_KEY = [...organizationAccountsKeys.detail('org-1')]
const INTEGRATIONS_KEY = [...searchIntegrationsQueryOptions('org-1').queryKey]
const HISTORY_KEY = [...searchHistoryKeys.list('org-1', 'viewer')]
const SECRET_SOURCE_KEY = [...organizationSecretKeys.source('org-1')]
const SESSION_KEY = [...sessionKeys.detail()]

const seeded = (state: DehydratedState) => state.queries.map(({ queryKey }) => queryKey)

/** Only the ids a principal carries are read from the session. */
const SESSION = { user: { id: 'viewer' }, session: { id: 'session-1' } } as NonNullable<
  Awaited<ReturnType<typeof getSession>>
>

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue(SESSION)
  mocks.accounts.mockResolvedValue(ACCOUNTS)
  mocks.integrations.mockResolvedValue([])
  mocks.history.mockResolvedValue({ sources: [], queries: [] })
  mocks.links.mockResolvedValue({ links: [LINK], nextCursor: 'next' })
  mocks.secretSource.mockResolvedValue({ source: null })
})

describe('seeding under the keys the hooks read', () => {
  it('seeds Home with the inventory and the recents', async () => {
    const keys = seeded(await prefetchHome(organization()))
    expect(keys).toHaveLength(3)
    expect(keys).toEqual(expect.arrayContaining([ACCOUNTS_KEY, INTEGRATIONS_KEY, HISTORY_KEY]))
  })

  it('seeds Search with the history, keyed to the session viewer', async () => {
    expect(seeded(await prefetchSearch(organization()))).toEqual([HISTORY_KEY])
  })

  it('unwraps the policies the way the hook does', async () => {
    const state = await prefetchIntegrations(organization())
    const policies = state.queries.find(
      ({ queryKey }) => JSON.stringify(queryKey) === JSON.stringify(INTEGRATIONS_KEY)
    )
    expect(policies?.state.data).toEqual([])
  })

  it('seeds Integrations with the Generic Secrets source the list reads', async () => {
    const keys = seeded(await prefetchIntegrations(organization()))
    expect(keys).toEqual(
      expect.arrayContaining([ACCOUNTS_KEY, INTEGRATIONS_KEY, SECRET_SOURCE_KEY])
    )
  })
})

describe('Links', () => {
  it('reads the list this URL asks for and caches it as the route sends it', async () => {
    const state = await prefetchSimLinks('org-1', { search: ' hand ', sort: 'popular', dir: 'asc' })
    expect(seeded(state)).toEqual([
      [...simLinksQueryOptions('org-1', 'hand', 'popular', 'asc').queryKey],
    ])
    expect(mocks.links).toHaveBeenLastCalledWith({
      principal: { kind: 'session', userId: 'viewer', sessionId: 'session-1' },
      input: { organizationId: 'org-1', search: 'hand', sort: 'popular', dir: 'asc' },
    })
    const { normalizedName, ...wire } = LINK
    expect(state.queries[0]?.state.data).toEqual({
      pages: [{ links: [{ ...wire, updatedAt: '2026-11-01T00:00:00.000Z' }], nextCursor: 'next' }],
      pageParams: [undefined],
    })
  })
})

describe('a viewer the route would refuse', () => {
  it('reads no inventory or history without member-scoped Search', async () => {
    expect(seeded(await prefetchHome(organization(false)))).toEqual([])
    expect(seeded(await prefetchSearch(organization(false)))).toEqual([])
    expect(seeded(await prefetchIntegrations(organization(false)))).toEqual([SECRET_SOURCE_KEY])
    expect(mocks.accounts).not.toHaveBeenCalled()
    expect(mocks.history).not.toHaveBeenCalled()
  })

  it('keeps the recents but not the inventory for one who cannot connect', async () => {
    expect(seeded(await prefetchHome(organization(true, false)))).toEqual([HISTORY_KEY])
  })
})

describe('a failed read', () => {
  it('stays out of hydration for the client and leaves its neighbours seeded', async () => {
    mocks.history.mockRejectedValue(new Error('database unavailable'))
    const keys = seeded(await prefetchHome(organization()))
    expect(keys).not.toContainEqual(HISTORY_KEY)
    expect(keys).toEqual(expect.arrayContaining([ACCOUNTS_KEY, INTEGRATIONS_KEY]))
  })

  it('stays out of hydration when the result has drifted from the route contract', async () => {
    mocks.history.mockResolvedValue({ sources: 'not a list', queries: [] })
    expect(seeded(await prefetchSearch(organization()))).toEqual([])
  })

  it('never fails the page', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    await expect(prefetchSimLinks('org-1', {})).resolves.toMatchObject({ queries: [] })
    await expect(prefetchSearch(organization())).resolves.toMatchObject({ queries: [] })
  })
})

describe('a slow read', () => {
  it('gives the shell back its workspace list seat at the budget instead of holding the page', async () => {
    vi.useFakeTimers()
    try {
      mocks.workspaces.mockReturnValue(new Promise(() => {}))
      mocks.profile.mockRejectedValue(new Error('not under test'))
      mocks.settings.mockRejectedValue(new Error('not under test'))
      const shell = prefetchShell({
        ...organization(),
        mothershipAvailable: false,
        // double-cast-allowed: only the fields the shell's reads gate on matter to what they seed
      } as unknown as PlatformOrganization)
      await vi.advanceTimersByTimeAsync(2_000)
      await expect(shell).resolves.toMatchObject({ queries: [] })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the session the shell seeds', () => {
  const CREATED = new Date('2026-01-01T00:00:00.000Z')
  const SERVER_SESSION = {
    user: {
      id: 'viewer',
      email: 'viewer@example.com',
      emailVerified: true,
      name: 'Viewer',
      image: null,
      role: 'user',
      createdAt: CREATED,
      updatedAt: CREATED,
      banned: false,
      banReason: null,
      stripeCustomerId: 'cus_secret',
    },
    session: {
      id: 'session-1',
      userId: 'viewer',
      token: 'session-token-secret',
      ipAddress: '203.0.113.7',
      userAgent: 'agent-secret',
      expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      createdAt: CREATED,
      updatedAt: CREATED,
      activeOrganizationId: 'org-1',
      impersonatedBy: 'admin-1',
    },
    // double-cast-allowed: the organization plugin's field is not on Better Auth's inferred type
  } as unknown as NonNullable<Awaited<ReturnType<typeof getSession>>>

  function shellFor() {
    mocks.workspaces.mockRejectedValue(new Error('not under test'))
    mocks.profile.mockRejectedValue(new Error('not under test'))
    mocks.settings.mockRejectedValue(new Error('not under test'))
    return prefetchShell({
      ...organization(),
      mothershipAvailable: false,
      // double-cast-allowed: only the fields the shell's reads gate on matter to what they seed
    } as unknown as PlatformOrganization)
  }

  it('holds the fields the client session query holds and none the server keeps', async () => {
    vi.mocked(getSession).mockResolvedValue(SERVER_SESSION)
    const state = await shellFor()
    const entry = state.queries.find(
      ({ queryKey }) => JSON.stringify(queryKey) === JSON.stringify(SESSION_KEY)
    )
    expect(entry?.state.data).toEqual({
      user: {
        id: 'viewer',
        email: 'viewer@example.com',
        emailVerified: true,
        name: 'Viewer',
        image: null,
        role: 'user',
        createdAt: CREATED,
        updatedAt: CREATED,
      },
      session: {
        id: 'session-1',
        userId: 'viewer',
        activeOrganizationId: 'org-1',
        impersonatedBy: 'admin-1',
      },
    })
    const payload = JSON.stringify(state)
    for (const secret of ['session-token-secret', '203.0.113.7', 'agent-secret', 'cus_secret']) {
      expect(payload).not.toContain(secret)
    }
  })

  it('ages from the server read, so the client query is fresh on first paint', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-09T12:00:00.000Z') })
    try {
      vi.mocked(getSession).mockResolvedValue(SERVER_SESSION)
      const state = await shellFor()
      const entry = state.queries.find(
        ({ queryKey }) => JSON.stringify(queryKey) === JSON.stringify(SESSION_KEY)
      )
      expect(entry?.state.status).toBe('success')
      expect(entry?.state.dataUpdatedAt).toBe(Date.parse('2026-11-09T12:00:00.000Z'))
    } finally {
      vi.useRealTimers()
    }
  })
})
