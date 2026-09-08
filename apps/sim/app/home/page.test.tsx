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

  it('sends a signed-out visitor to login without resolving an entry', async () => {
    mockGetSession.mockResolvedValue(null)

    await expect(AppEntryPage()).rejects.toThrow('NEXT_REDIRECT:/login')
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
