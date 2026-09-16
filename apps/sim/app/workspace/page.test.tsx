/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  workspaces: vi.fn(),
  recentWorkspace: vi.fn(),
  request: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'viewer' } }, isPending: false }),
}))
vi.mock('@/lib/auth/stale-session-recovery', () => ({ recoverFromStaleSession: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))
vi.mock('@/lib/core/utils/browser-storage', () => ({
  WorkspaceRecencyStorage: { getMostRecent: mocks.recentWorkspace },
}))
vi.mock('@/app/_shell/desktop-title-bar', () => ({ DesktopTitleBarLane: () => null }))
vi.mock('@/hooks/queries/workspace', () => ({ useWorkspacesWithMetadata: mocks.workspaces }))

import WorkspacePage from '@/app/workspace/page'

describe('workspace settings destination', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    window.history.replaceState(null, '', '/workspace?redirect=settings')
    mocks.recentWorkspace.mockReturnValue('workspace-2')
    mocks.workspaces.mockReturnValue({
      data: {
        workspaces: [{ id: 'workspace-1' }, { id: 'workspace-2' }],
        lastActiveWorkspaceId: 'workspace-1',
      },
      isLoading: false,
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('opens full settings in the most recent accessible workspace', async () => {
    await act(async () => root.render(<WorkspacePage />))
    expect(mocks.replace).toHaveBeenCalledWith('/workspace/workspace-2/settings/general')
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('uses an accessible workspace when the locally remembered workspace is unavailable', async () => {
    mocks.recentWorkspace.mockReturnValue('removed-workspace')
    await act(async () => root.render(<WorkspacePage />))
    expect(mocks.replace).toHaveBeenCalledWith('/workspace/workspace-1/settings/general')
  })

  it('preserves the settings destination after creating a permitted first workspace', async () => {
    mocks.workspaces.mockReturnValue({
      data: { workspaces: [], creationPolicy: { canCreate: true } },
      isLoading: false,
    })
    mocks.request.mockResolvedValue({ workspace: { id: 'new-workspace' } })
    await act(async () => root.render(<WorkspacePage />))
    expect(mocks.replace).toHaveBeenCalledWith('/workspace/new-workspace/settings/general')
  })

  it('keeps the access-denied state when workspace creation is blocked', async () => {
    mocks.workspaces.mockReturnValue({
      data: {
        workspaces: [],
        creationPolicy: { canCreate: false, workspaceMode: 'organization' },
      },
      isLoading: false,
    })
    await act(async () => root.render(<WorkspacePage />))
    expect(container.textContent).toContain('No workspace access yet')
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('preserves normal workspace navigation without a settings destination', async () => {
    window.history.replaceState(null, '', '/workspace')
    await act(async () => root.render(<WorkspacePage />))
    expect(mocks.replace).toHaveBeenCalledWith('/workspace/workspace-2')
  })
})
