/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  params: { workspaceId: 'workspace-1' } as Record<string, string>,
  socket: {
    isReconnecting: true,
    isRetryingWorkflowJoin: false,
    blockedJoinWorkflowId: null as string | null,
  },
  hasOperationError: false,
  toast: { error: vi.fn(() => 'toast-1'), dismiss: vi.fn() },
  setQueryData: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('next/navigation', () => ({ useParams: () => mocks.params }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: mocks.setQueryData }),
}))
vi.mock('@/app/workspace/providers/socket-provider', () => ({ useSocket: () => mocks.socket }))
vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacePermissionsQuery: () => ({
    data: null,
    isLoading: false,
    error: null,
    refetch: mocks.refetch,
  }),
  workspaceKeys: { permissions: (id: string) => ['workspace', id, 'permissions'] },
}))
vi.mock('@/hooks/use-stable-flag', () => ({ useStableFlag: (value: boolean) => value }))
vi.mock('@/hooks/use-user-permissions', () => ({
  useUserPermissions: () => ({
    canRead: true,
    canEdit: true,
    canAdmin: true,
    userPermissions: 'admin',
    isLoading: false,
    error: null,
  }),
}))
vi.mock('@/stores/operation-queue/store', () => ({
  useOperationQueueStore: (select: (state: { hasOperationError: boolean }) => boolean) =>
    select({ hasOperationError: mocks.hasOperationError }),
}))

import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('workspace reconnect notifications', () => {
  let host: HTMLDivElement
  let root: Root

  function renderProvider() {
    act(() =>
      root.render(
        <WorkspacePermissionsProvider>
          <div />
        </WorkspacePermissionsProvider>
      )
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.params = { workspaceId: 'workspace-1' }
    mocks.socket.isReconnecting = true
    mocks.socket.isRetryingWorkflowJoin = false
    mocks.socket.blockedJoinWorkflowId = null
    mocks.hasOperationError = false
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('leaves file reconnect feedback to the inline editor status', () => {
    mocks.params.fileId = 'file-1'
    renderProvider()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('retains reconnect feedback elsewhere in the workspace', () => {
    mocks.params.workflowId = 'workflow-1'
    renderProvider()
    expect(mocks.toast.error).toHaveBeenCalledWith('Reconnecting...', expect.any(Object))
  })

  it('dismisses the workspace reconnect toast when entering a file', () => {
    renderProvider()
    mocks.params.fileId = 'file-1'
    renderProvider()
    expect(mocks.toast.dismiss).toHaveBeenCalledWith('toast-1')
    expect(mocks.toast.error).toHaveBeenCalledTimes(1)
  })

  it('does not suppress terminal operation errors inside a file', () => {
    mocks.params.fileId = 'file-1'
    mocks.hasOperationError = true
    renderProvider()
    expect(mocks.toast.error).toHaveBeenCalledWith('Connection unavailable', expect.any(Object))
  })
})
