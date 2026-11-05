/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseWorkspacesWithMetadata } = vi.hoisted(() => ({
  mockUseWorkspacesWithMetadata: vi.fn(),
}))

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacesWithMetadata: mockUseWorkspacesWithMetadata,
}))

import WorkspacePage from '@/app/workspace/page'

const mockReplace = nextNavigationMockFns.router.replace

describe('WorkspacePage for a viewer with nothing to pick', () => {
  let container: HTMLDivElement
  let root: Root

  function visit(search: string, list: { forwardOrganizationId?: string }) {
    window.history.pushState({}, '', `/workspace${search}`)
    mockUseWorkspacesWithMetadata.mockReturnValue({
      data: {
        workspaces: [],
        lastActiveWorkspaceId: null,
        pinnedWorkspaceIds: [],
        creationPolicy: { canCreate: false, workspaceMode: 'organization' },
        ...list,
      },
      isLoading: false,
      error: null,
    })
    act(() => root.render(<WorkspacePage />))
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mockReplace.mockClear()
    authClientMockFns.mockUseSession.mockReturnValue({
      data: { user: { id: 'viewer' } },
      isPending: false,
      error: null,
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('forwards to the organization without showing the blocked card', () => {
    visit('', { forwardOrganizationId: 'org-1' })
    expect(mockReplace).toHaveBeenCalledExactlyOnceWith('/o/org-1/home')
    expect(container.querySelector('h1')).toBeNull()
  })

  it('carries a settings request to the organization settings', () => {
    visit('?redirect=settings', { forwardOrganizationId: 'org-1' })
    expect(mockReplace).toHaveBeenCalledExactlyOnceWith('/o/org-1/settings/general')
  })

  it('stays on the blocked card when no organization can serve them', () => {
    visit('', {})
    expect(mockReplace).not.toHaveBeenCalled()
    expect(container.querySelector('h1')).not.toBeNull()
  })
})
