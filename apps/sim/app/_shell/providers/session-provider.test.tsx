/**
 * @vitest-environment jsdom
 */
import { act, useContext } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockSetActive, mockRequestJson } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSetActive: vi.fn(),
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: {
    getSession: mockGetSession,
    organization: { setActive: mockSetActive },
  },
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('posthog-js', () => ({
  default: {
    identify: vi.fn(),
    reset: vi.fn(),
    startSessionRecording: vi.fn(),
    sessionRecordingStarted: vi.fn(() => true),
  },
}))

import {
  type AppSession,
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

/** Flush pending microtasks inside an act() boundary. */
async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
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

  it('upgrade path: fresh disableCookieCache read wins even when the stale mount query resolves LAST', async () => {
    setSearch('?upgraded=true')

    const mount = defer<{ data: AppSession }>()
    const upgrade = defer<{ data: AppSession }>()

    mockGetSession.mockImplementation((arg?: unknown) => {
      if (isUpgradeCall(arg)) return upgrade.promise
      return mount.promise
    })
    // activeOrganizationId is present, so setActive / listCreatorOrganizations are not reached.

    const h = renderProvider()
    await flush()

    // Resolve the fresh upgrade read FIRST. The cancelQueries guard runs before
    // setQueryData, cancelling the in-flight stale mount query.
    await act(async () => {
      upgrade.resolve({ data: FRESH_SESSION })
      await Promise.resolve()
    })
    await flush()

    // Now the stale mount query resolves LATE. Because it was cancelled, its
    // result must NOT clobber the fresh value written to the cache.
    await act(async () => {
      mount.resolve({ data: STALE_SESSION })
      await Promise.resolve()
    })
    await flushUntil(() => h.ctx()?.data != null)

    expect(h.queryClient.getQueryData(sessionKeys.detail())).toEqual(FRESH_SESSION)
    expect(h.ctx()?.data).toEqual(FRESH_SESSION)
    expect(h.ctx()?.data).not.toEqual(STALE_SESSION)

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
