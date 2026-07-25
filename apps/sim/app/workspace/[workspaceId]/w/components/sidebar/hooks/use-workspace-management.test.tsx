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
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: (
    selector: (state: { switchToWorkspace: typeof mockSwitchToWorkspace }) => unknown
  ) => selector({ switchToWorkspace: mockSwitchToWorkspace }),
}))

import { useWorkspaceManagement } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-workspace-management'

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
