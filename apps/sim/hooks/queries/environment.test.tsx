/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const { mockFetchWorkspaceEnvironment } = vi.hoisted(() => ({
  mockFetchWorkspaceEnvironment: vi.fn(),
}))

vi.mock('@/lib/environment/api', () => ({
  fetchPersonalEnvironment: vi.fn(),
  fetchWorkspaceEnvironment: mockFetchWorkspaceEnvironment,
}))

import { environmentKeys, useWorkspaceEnvironment } from '@/hooks/queries/environment'

describe('useWorkspaceEnvironment', () => {
  it('does not retain decrypted values while a different workspace loads', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    const root = createRoot(container)
    const pendingWorkspace = new Promise<never>(() => {})

    queryClient.setQueryData(environmentKeys.workspace('workspace-1'), {
      workspace: { SHARED_KEY: 'workspace-1-secret' },
      personal: {},
      conflicts: [],
    })
    mockFetchWorkspaceEnvironment.mockReturnValueOnce(pendingWorkspace)

    function Probe({ workspaceId }: { workspaceId: string }) {
      const { data } = useWorkspaceEnvironment(workspaceId)
      return <span>{data?.workspace.SHARED_KEY ?? 'loading'}</span>
    }

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe workspaceId='workspace-1' />
        </QueryClientProvider>
      )
    })
    expect(container.textContent).toBe('workspace-1-secret')

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe workspaceId='workspace-2' />
        </QueryClientProvider>
      )
    })

    expect(container.textContent).toBe('loading')
    act(() => root.unmount())
  })
})
