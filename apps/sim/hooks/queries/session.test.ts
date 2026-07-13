/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: {
    getSession: mockGetSession,
  },
}))

import { refreshSessionQuery, sessionKeys } from '@/hooks/queries/session'

const CACHED_SESSION = {
  user: { id: 'user-1', email: 'cached@example.com' },
  session: { id: 'session-1', userId: 'user-1', activeOrganizationId: 'organization-1' },
}

const FRESH_SESSION = {
  user: { id: 'user-1', email: 'fresh@example.com' },
  session: { id: 'session-2', userId: 'user-1', activeOrganizationId: 'organization-2' },
}

describe('refreshSessionQuery', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient()
    queryClient.setQueryData(sessionKeys.detail(), CACHED_SESSION)
  })

  it('writes and returns a successful session response', async () => {
    mockGetSession.mockResolvedValue({ data: FRESH_SESSION, error: null })

    await expect(refreshSessionQuery(queryClient)).resolves.toEqual(FRESH_SESSION)
    expect(queryClient.getQueryData(sessionKeys.detail())).toEqual(FRESH_SESSION)
  })

  it('preserves a legitimate unauthenticated response', async () => {
    mockGetSession.mockResolvedValue({ data: null, error: null })

    await expect(refreshSessionQuery(queryClient)).resolves.toBeNull()
    expect(queryClient.getQueryData(sessionKeys.detail())).toBeNull()
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
