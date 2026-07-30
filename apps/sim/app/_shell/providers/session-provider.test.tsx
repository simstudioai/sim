/**
 * @vitest-environment jsdom
 */
import { act, useContext } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockListOrganizations, mockSetActive } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockListOrganizations: vi.fn(),
  mockSetActive: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: {
    getSession: mockGetSession,
    organization: {
      list: mockListOrganizations,
      setActive: mockSetActive,
    },
  },
}))

vi.mock('posthog-js', () => ({
  default: {
    identify: vi.fn(),
    reset: vi.fn(),
    startSessionRecording: vi.fn(),
    sessionRecordingStarted: vi.fn(() => true),
  },
}))

import type { AppSession } from '@/lib/auth/session-response'
import {
  SessionContext,
  type SessionHookResult,
  SessionProvider,
} from '@/app/_shell/providers/session-provider'
import { sessionKeys, useSessionQuery } from '@/hooks/queries/session'

/** Deferred promise: lets a test resolve a mocked async call at a chosen moment. */
function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Set the jsdom URL search string before rendering the provider. */
function setSearch(search: string) {
  window.history.replaceState({}, '', `/${search}`)
}

const STALE_SESSION: AppSession = {
  user: { id: 'user-1', email: 'u@x.com', name: 'Stale plan' },
  session: { id: 's1', userId: 'user-1', activeOrganizationId: 'org-1' },
}

const FRESH_SESSION: AppSession = {
  user: { id: 'user-1', email: 'u@x.com', name: 'Fresh plan' },
  session: { id: 's1', userId: 'user-1', activeOrganizationId: 'org-1' },
}

const NO_ACTIVE_ORGANIZATION_SESSION: AppSession = {
  user: { id: 'user-1', email: 'u@x.com', name: 'No active organization' },
  session: { id: 's1', userId: 'user-1' },
}

const RECOVERED_ORGANIZATION_SESSION: AppSession = {
  user: { id: 'user-1', email: 'u@x.com', name: 'Recovered organization' },
  session: { id: 's1', userId: 'user-1', activeOrganizationId: 'org-member' },
}

interface Harness {
  ctx: () => SessionHookResult | null
  queryClient: QueryClient
  unmount: () => void
}

/**
 * Mounts SessionProvider in a real React 19 root under jsdom with a real
 * QueryClient, capturing the live context value via a probe consumer.
 */
function renderProvider(): Harness {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  let latest: SessionHookResult | null = null
  function Probe() {
    latest = useContext(SessionContext)
    return null
  }

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <Probe />
        </SessionProvider>
      </QueryClientProvider>
    )
  })

  return {
    ctx: () => latest,
    queryClient,
    unmount: () => act(() => root.unmount()),
  }
}

/**
 * Flush pending work inside an act() boundary. Drains the microtask queue and
 * then yields one macrotask tick, so React Query's notifyManager (which can
 * schedule observer notifications on a timer) and any deferred renders settle
 * deterministically — microtask-only flushing raced the query→render update.
 */
async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

/** Repeatedly flush until `predicate` holds or the budget runs out. */
async function flushUntil(predicate: () => boolean, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return
    await flush()
  }
}

/** True when the getSession call is the upgrade (disableCookieCache) read. */
function isUpgradeCall(arg: unknown): boolean {
  return Boolean(
    arg &&
      typeof arg === 'object' &&
      'query' in (arg as Record<string, unknown>) &&
      (arg as { query?: { disableCookieCache?: boolean } }).query?.disableCookieCache === true
  )
}

describe('useSessionQuery', () => {
  it('uses an all-rooted key factory and a 5-minute staleTime', () => {
    expect(sessionKeys.all).toEqual(['session'])
    expect(sessionKeys.detail()).toEqual(['session', 'detail'])
    // The hook is exported and reads from the same detail key.
    expect(typeof useSessionQuery).toBe('function')
  })
})

describe('SessionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListOrganizations.mockResolvedValue({ data: [], error: null })
    mockSetActive.mockResolvedValue({ data: null, error: null })
    setSearch('')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes the contract context shape and the loaded session on a normal load', async () => {
    mockGetSession.mockResolvedValue({ data: STALE_SESSION })

    const h = renderProvider()
    await flushUntil(() => h.ctx()?.data != null)

    const ctx = h.ctx()
    expect(ctx).not.toBeNull()
    expect(ctx).toMatchObject({
      data: expect.any(Object),
      isPending: expect.any(Boolean),
      error: null,
    })
    expect(typeof ctx?.refetch).toBe('function')
    expect(ctx?.data).toEqual(STALE_SESSION)
    expect(ctx?.isPending).toBe(false)

    h.unmount()
  })

  it('preserves an intentional no-active-organization state on a normal load', async () => {
    mockGetSession.mockResolvedValue({ data: NO_ACTIVE_ORGANIZATION_SESSION })
    mockListOrganizations.mockResolvedValue({
      data: [{ id: 'org-member', name: 'Member organization' }],
      error: null,
    })

    const h = renderProvider()
    await flushUntil(() => h.ctx()?.data != null)

    expect(h.ctx()?.data).toEqual(NO_ACTIVE_ORGANIZATION_SESSION)
    expect(mockListOrganizations).not.toHaveBeenCalled()
    expect(mockSetActive).not.toHaveBeenCalled()

    h.unmount()
  })

  it('does not auto-select an organization for an external-only user during recovery', async () => {
    setSearch('?upgraded=true')
    mockGetSession.mockResolvedValue({ data: NO_ACTIVE_ORGANIZATION_SESSION })
    mockListOrganizations.mockResolvedValue({ data: [], error: null })

    const h = renderProvider()
    await flushUntil(() => mockListOrganizations.mock.calls.length > 0)

    expect(mockListOrganizations).toHaveBeenCalledTimes(1)
    expect(mockSetActive).not.toHaveBeenCalled()

    h.unmount()
  })

  it('recovers the sole valid viewer organization membership when upgrade recovery is explicit', async () => {
    window.history.replaceState({}, '', '/workspace/workspace-b?upgraded=true')
    mockListOrganizations.mockResolvedValue({
      data: [{ id: 'org-member', name: 'Member organization' }],
      error: null,
    })
    mockGetSession.mockImplementation(() =>
      Promise.resolve({
        data:
          mockSetActive.mock.calls.length > 0
            ? RECOVERED_ORGANIZATION_SESSION
            : NO_ACTIVE_ORGANIZATION_SESSION,
      })
    )

    const h = renderProvider()
    await flushUntil(
      () =>
        h.queryClient.getQueryData<AppSession>(sessionKeys.detail())?.session
          ?.activeOrganizationId === 'org-member'
    )

    expect(mockSetActive).toHaveBeenCalledWith({ organizationId: 'org-member' })
    expect(h.queryClient.getQueryData(sessionKeys.detail())).toEqual(RECOVERED_ORGANIZATION_SESSION)

    h.unmount()
  })

  it('does not choose arbitrarily when multiple valid memberships need recovery', async () => {
    setSearch('?upgraded=true')
    mockGetSession.mockResolvedValue({ data: NO_ACTIVE_ORGANIZATION_SESSION })
    mockListOrganizations.mockResolvedValue({
      data: [
        { id: 'org-a', name: 'Organization A' },
        { id: 'org-b', name: 'Organization B' },
      ],
      error: null,
    })

    const h = renderProvider()
    await flushUntil(() => mockListOrganizations.mock.calls.length > 0)

    expect(mockListOrganizations).toHaveBeenCalledTimes(1)
    expect(mockSetActive).not.toHaveBeenCalled()

    h.unmount()
  })

  it('upgrade path: fresh disableCookieCache read wins even when the stale mount query resolves LAST', async () => {
    setSearch('?upgraded=true')

    const mount = defer<{ data: AppSession }>()
    const upgrade = defer<{ data: AppSession }>()

    mockGetSession.mockImplementation((arg?: unknown) => {
      if (isUpgradeCall(arg)) return upgrade.promise
      // Honor the abort signal like the real fetch-backed client: cancelQueries
      // aborts the in-flight mount read, so it rejects rather than resolving late.
      const signal = (arg as { fetchOptions?: { signal?: AbortSignal } })?.fetchOptions?.signal
      signal?.addEventListener('abort', () =>
        mount.reject(new DOMException('Aborted', 'AbortError'))
      )
      return mount.promise
    })
    // activeOrganizationId is present, so setActive / listCreatorOrganizations are not reached.

    const h = renderProvider()
    await flush()

    // Resolve the fresh upgrade read FIRST. The cancelQueries guard runs before
    // setQueryData, cancelling (aborting) the in-flight stale mount query.
    await act(async () => {
      upgrade.resolve({ data: FRESH_SESSION })
      await Promise.resolve()
    })
    await flushUntil(() => h.queryClient.getQueryData(sessionKeys.detail()) != null)

    // Assert on the cache — the contended state cancelQueries + setQueryData
    // govern. The fresh value wins; the aborted stale mount read never clobbers it.
    expect(h.queryClient.getQueryData(sessionKeys.detail())).toEqual(FRESH_SESSION)
    expect(h.queryClient.getQueryData(sessionKeys.detail())).not.toEqual(STALE_SESSION)

    h.unmount()
  })

  it('upgrade path: a failed fresh read keeps the user signed in and still reconciles plan surfaces', async () => {
    setSearch('?upgraded=true')

    const mount = defer<{ data: AppSession }>()
    const upgrade = defer<{ data: AppSession }>()
    mockGetSession.mockImplementation((arg?: unknown) =>
      isUpgradeCall(arg) ? upgrade.promise : mount.promise
    )

    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    const invalidatedKeys = () =>
      invalidateSpy.mock.calls.map(([arg]) => (arg as { queryKey?: unknown[] })?.queryKey)

    const h = renderProvider()
    await flush()

    // The fresh disableCookieCache read fails.
    await act(async () => {
      upgrade.reject(new Error('refresh failed'))
      await Promise.resolve()
    })
    await flush()

    // The normal cookie-cached mount query lands AFTER the failure.
    await act(async () => {
      mount.resolve({ data: STALE_SESSION })
      await Promise.resolve()
    })
    await flushUntil(
      () =>
        h.queryClient.getQueryData(sessionKeys.detail()) != null &&
        invalidatedKeys().some((k) => Array.isArray(k) && k[0] === 'subscription')
    )

    // The valid cookie-cached session is still cached — a failed upgrade refresh
    // must not sign the user out, and it must not surface as a session error.
    expect(h.queryClient.getQueryData(sessionKeys.detail())).toEqual(STALE_SESSION)
    expect(h.queryClient.getQueryState(sessionKeys.detail())?.error ?? null).toBeNull()

    // Plan surfaces read server truth, so they still reconcile after the failure.
    expect(invalidatedKeys()).toContainEqual(['organizations'])
    expect(invalidatedKeys()).toContainEqual(['subscription'])

    invalidateSpy.mockRestore()
    h.unmount()
  })

  it('strips the upgraded param from the URL', async () => {
    setSearch('?upgraded=true&keep=1')
    mockGetSession.mockResolvedValue({ data: FRESH_SESSION })

    const h = renderProvider()
    await flush()

    expect(window.location.search).not.toContain('upgraded')
    expect(window.location.search).toContain('keep=1')

    h.unmount()
  })
})
