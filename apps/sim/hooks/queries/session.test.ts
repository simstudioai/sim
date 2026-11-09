/** @vitest-environment jsdom */
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { sleep } from '@sim/utils/helpers'
import { dehydrate, hydrate, QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  renderDataHook,
  unmountDataHooks,
} from '@/hooks/queries/utils/render-data-hook.test-support'

vi.mock('@/lib/auth/client', () => authClientMock)

import { refreshSessionQuery, useSessionQuery } from '@/hooks/queries/session'
import { sessionKeys } from '@/hooks/queries/utils/session-keys'

const mockGetSession = authClientMockFns.mockClient.getSession

const CACHED_SESSION = {
  user: { id: 'user-1', email: 'cached@example.com' },
  session: { id: 'session-1', userId: 'user-1', activeOrganizationId: 'organization-1' },
}

describe('refreshSessionQuery', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient()
    queryClient.setQueryData(sessionKeys.detail(), CACHED_SESSION)
  })

  it('rejects a resolved Better Auth error envelope without poisoning the cache', async () => {
    mockGetSession.mockResolvedValue({
      data: null,
      error: {
        message: 'Session refresh denied',
        status: 401,
        statusText: 'Unauthorized',
      },
    })

    await expect(refreshSessionQuery(queryClient)).rejects.toThrow('Session refresh denied')
    expect(queryClient.getQueryData(sessionKeys.detail())).toEqual(CACHED_SESSION)
  })

  it('leaves the cache untouched when the session transport throws', async () => {
    mockGetSession.mockRejectedValue(new Error('Network unavailable'))

    await expect(refreshSessionQuery(queryClient)).rejects.toThrow('Network unavailable')
    expect(queryClient.getQueryData(sessionKeys.detail())).toEqual(CACHED_SESSION)
  })
})

/**
 * Failure modes: a session the server seeded is read again on mount (the first-paint request the
 * seed exists to remove), or the seed ages from the wrong time so a long-open page never re-checks.
 */
describe('useSessionQuery over a server-seeded session', () => {
  afterEach(async () => {
    await unmountDataHooks()
    mockGetSession.mockReset()
  })

  function seededClient(readAt: number) {
    const server = new QueryClient()
    server.setQueryData(sessionKeys.detail(), CACHED_SESSION, { updatedAt: readAt })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    hydrate(client, dehydrate(server))
    return client
  }

  it('renders the seeded viewer without reading the session again', async () => {
    mockGetSession.mockResolvedValue({ data: CACHED_SESSION })
    const { result } = await renderDataHook(useSessionQuery, {
      queryClient: seededClient(Date.now()),
    })
    expect(result.current.data).toEqual(CACHED_SESSION)
    await sleep(0)
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('re-reads a seed older than the stale time on mount', async () => {
    mockGetSession.mockResolvedValue({ data: CACHED_SESSION })
    await renderDataHook(useSessionQuery, {
      queryClient: seededClient(Date.now() - 6 * 60 * 1000),
    })
    await vi.waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(1))
  })
})
