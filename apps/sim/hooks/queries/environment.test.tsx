/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWorkspaceEnvironment } = vi.hoisted(() => ({
  mockFetchWorkspaceEnvironment: vi.fn(),
}))

vi.mock('@/lib/environment/api', () => ({
  fetchPersonalEnvironment: vi.fn(),
  fetchWorkspaceEnvironment: mockFetchWorkspaceEnvironment,
}))

import { useWorkspaceEnvironment } from '@/hooks/queries/environment'

function renderWorkspaceEnvironment(workspaceId: string, enabled?: boolean) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const container = document.createElement('div')
  const root = createRoot(container)

  function Probe() {
    useWorkspaceEnvironment(workspaceId, { enabled })
    return null
  }

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    )
  })

  return () => act(() => root.unmount())
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useWorkspaceEnvironment', () => {
  it('does not run without a workspace ID even when the caller enables it', () => {
    const unmount = renderWorkspaceEnvironment('', true)

    expect(mockFetchWorkspaceEnvironment).not.toHaveBeenCalled()
    unmount()
  })

  it('respects an explicit caller opt-out when a workspace ID exists', () => {
    const unmount = renderWorkspaceEnvironment('workspace-1', false)

    expect(mockFetchWorkspaceEnvironment).not.toHaveBeenCalled()
    unmount()
  })
})
