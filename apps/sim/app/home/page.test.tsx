import { authMockFns } from '@sim/testing'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { describe, expect, it, vi } from 'vitest'

const { mockResolveAppEntryPath } = vi.hoisted(() => ({
  mockResolveAppEntryPath: vi.fn(),
}))

vi.mock('next/navigation', () => nextNavigationMock)

vi.mock('@/lib/navigation/resolve-app-entry', () => ({
  resolveAppEntryPath: mockResolveAppEntryPath,
}))

import AppEntryPage from '@/app/home/page'

const mockRedirect = nextNavigationMockFns.mockRedirect

const mockGetSession = authMockFns.mockGetSession

describe('AppEntryPage', () => {
  /**
   * The proxy sends cookie-less requests to /login before this route renders, so a
   * null session here is always a stale cookie. Redirecting to /login would be
   * bounced back by the proxy's presence-only cookie check, looping forever.
   */
  it('sends a stale-cookie viewer to the recovery surface, never back to login', async () => {
    mockGetSession.mockResolvedValue(null)

    await expect(AppEntryPage()).rejects.toThrow('NEXT_REDIRECT:/workspace')
    expect(mockRedirect).not.toHaveBeenCalledWith('/login')
    expect(mockResolveAppEntryPath).not.toHaveBeenCalled()
  })
})
