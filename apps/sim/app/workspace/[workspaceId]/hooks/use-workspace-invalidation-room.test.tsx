/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (data?: { workspaceId: string }) => void>()
const socket = {
  connected: true,
  emit: vi.fn(),
  on: vi.fn((event: string, handler: (data?: { workspaceId: string }) => void) => {
    handlers.set(event, handler)
  }),
  off: vi.fn(),
}

vi.mock('@/app/workspace/providers/socket-provider', () => ({
  useSocket: () => ({ socket }),
}))

import { useWorkspaceInvalidationRoom } from './use-workspace-invalidation-room'

describe('useWorkspaceInvalidationRoom', () => {
  afterEach(() => {
    handlers.clear()
    vi.clearAllMocks()
  })

  it('runs catch-up invalidation after a successful initial join and rejoin', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    const root = createRoot(container)
    const onChanged = vi.fn()

    function Probe() {
      useWorkspaceInvalidationRoom('workspace-1', ROOM_TYPES.WORKSPACE_WORKFLOWS, onChanged)
      return null
    }

    act(() => root.render(<Probe />))
    expect(socket.emit).toHaveBeenCalledWith('join-workspace-workflows', {
      workspaceId: 'workspace-1',
    })

    act(() => handlers.get('join-workspace-workflows-success')?.({ workspaceId: 'workspace-1' }))
    act(() => handlers.get('connect')?.())
    act(() => handlers.get('join-workspace-workflows-success')?.({ workspaceId: 'workspace-1' }))

    expect(onChanged).toHaveBeenCalledTimes(2)
    act(() => root.unmount())
  })
})
