/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockPush,
  mockRequestJson,
  mockSwitchToWorkspace,
  mockUseWorkspacesQuery,
  mockUseWorkspaceCreationPolicy,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRequestJson: vi.fn(),
  mockSwitchToWorkspace: vi.fn(),
  mockUseWorkspacesQuery: vi.fn(),
  mockUseWorkspaceCreationPolicy: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/workspace-denied',
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/hooks/queries/invitations', () => ({
  useLeaveWorkspace: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/queries/workspace', () => ({
  useCreateWorkspace: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteWorkspace: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateWorkspace: () => ({ mutateAsync: vi.fn() }),
  useWorkspaceCreationPolicy: mockUseWorkspaceCreationPolicy,
  useWorkspacesQuery: mockUseWorkspacesQuery,
  /** No pins: this suite is about the deep-link guard, not switcher ordering. */
  EMPTY_PINNED_WORKSPACE_IDS: new Set<string>(),
  usePinnedWorkspaceIds: () => ({ data: new Set<string>() }),
  useToggleWorkspacePin: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: (
    selector: (state: { switchToWorkspace: typeof mockSwitchToWorkspace }) => unknown
  ) => selector({ switchToWorkspace: mockSwitchToWorkspace }),
}))

import {
  resolveWorkspaceSwitchHref,
  useWorkspaceManagement,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-workspace-management'

describe('resolveWorkspaceSwitchHref', () => {
  it('preserves the active settings section', () => {
    expect(
      resolveWorkspaceSwitchHref({
        pathname: '/workspace/workspace-a/settings/mcp',
        currentWorkspaceId: 'workspace-a',
        targetWorkspaceId: 'workspace-b',
      })
    ).toBe('/workspace/workspace-b/settings/mcp')
  })

  it('drops workspace-scoped settings detail segments', () => {
    expect(
      resolveWorkspaceSwitchHref({
        pathname: '/workspace/workspace-a/settings/secrets/credential-a',
        currentWorkspaceId: 'workspace-a',
        targetWorkspaceId: 'workspace-b',
      })
    ).toBe('/workspace/workspace-b/settings/secrets')
  })

  it('navigates to the workspace root outside settings', () => {
    expect(
      resolveWorkspaceSwitchHref({
        pathname: '/workspace/workspace-a/w/workflow-a',
        currentWorkspaceId: 'workspace-a',
        targetWorkspaceId: 'workspace-b',
      })
    ).toBe('/workspace/workspace-b')
  })

  it('fails fast when a settings pathname has no section', () => {
    expect(() =>
      resolveWorkspaceSwitchHref({
        pathname: '/workspace/workspace-a/settings/',
        currentWorkspaceId: 'workspace-a',
        targetWorkspaceId: 'workspace-b',
      })
    ).toThrow('Settings pathname is missing a section')
  })
})

function Harness() {
  useWorkspaceManagement({ workspaceId: 'workspace-denied', sessionUserId: 'user-1' })
  return null
}

let container: HTMLDivElement
let root: Root

describe('useWorkspaceManagement direct access guard', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    localStorage.clear()
    mockUseWorkspacesQuery.mockReturnValue({
      data: [
        {
          id: 'workspace-accessible',
          name: 'Accessible workspace',
          ownerId: 'user-1',
          organizationId: null,
          workspaceMode: 'personal',
        },
      ],
      isLoading: false,
      isFetching: false,
    })
    mockUseWorkspaceCreationPolicy.mockReturnValue({ data: null })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('does not silently redirect an unauthorized deep link to another workspace', async () => {
    await act(async () => {
      root.render(<Harness />)
      await Promise.resolve()
    })

    expect(mockPush).not.toHaveBeenCalled()
  })
})
