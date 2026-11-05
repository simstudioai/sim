/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveWorkspacelessMemberPath } = vi.hoisted(() => ({
  mockResolveWorkspacelessMemberPath: vi.fn(),
}))

vi.mock('next/navigation', () => nextNavigationMock)

vi.mock('@/lib/navigation/resolve-app-entry', () => ({
  resolveWorkspacelessMemberPath: mockResolveWorkspacelessMemberPath,
}))

vi.mock('@/app/workspace/workspace-entry', () => ({ WorkspaceEntry: () => null }))

import WorkspacePage from '@/app/workspace/page'

const mockGetSession = authMockFns.mockGetSession
const session = { user: { id: 'viewer' } }

function visit(search: { redirect?: string } = {}) {
  return WorkspacePage({ searchParams: Promise.resolve(search) })
}

describe('WorkspacePage', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue(session)
    mockResolveWorkspacelessMemberPath.mockResolvedValue(null)
  })

  it('forwards a workspaceless member before the picker renders', async () => {
    mockResolveWorkspacelessMemberPath.mockResolvedValue('/o/org-1/home')
    await expect(visit()).rejects.toThrow('NEXT_REDIRECT:/o/org-1/home')
    expect(mockResolveWorkspacelessMemberPath).toHaveBeenCalledWith(session, 'home')
  })

  it('carries a settings request through to the destination', async () => {
    mockResolveWorkspacelessMemberPath.mockResolvedValue('/o/org-1/settings/general')
    await expect(visit({ redirect: 'settings' })).rejects.toThrow(
      'NEXT_REDIRECT:/o/org-1/settings/general'
    )
    expect(mockResolveWorkspacelessMemberPath).toHaveBeenCalledWith(session, 'settings')
  })

  it('leaves a stale session on the recovery surface', async () => {
    mockGetSession.mockResolvedValue(null)
    await expect(visit()).resolves.toBeTruthy()
    expect(mockResolveWorkspacelessMemberPath).not.toHaveBeenCalled()
  })

  it.each([
    ['session', () => mockGetSession.mockRejectedValue(new Error('down'))],
    ['destination', () => mockResolveWorkspacelessMemberPath.mockRejectedValue(new Error('down'))],
  ])('keeps the recovery surface when the %s lookup fails', async (_label, fail) => {
    fail()
    await expect(visit()).resolves.toBeTruthy()
  })
})
