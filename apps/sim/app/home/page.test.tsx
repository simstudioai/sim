/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRedirect, mockResolveAppEntryPath } = vi.hoisted(() => ({
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
  mockResolveAppEntryPath: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('@/lib/navigation/resolve-app-entry', () => ({
  resolveAppEntryPath: mockResolveAppEntryPath,
}))

import AppEntryPage from '@/app/home/page'

const mockGetSession = authMockFns.mockGetSession

describe('AppEntryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('forwards a signed-in viewer to their resolved entry', async () => {
    const session = { user: { id: 'viewer' } }
    mockGetSession.mockResolvedValue(session)
    mockResolveAppEntryPath.mockResolvedValue('/o/org-1/home')

    await expect(AppEntryPage()).rejects.toThrow('NEXT_REDIRECT:/o/org-1/home')
    expect(mockResolveAppEntryPath).toHaveBeenCalledWith(session)
  })
})
