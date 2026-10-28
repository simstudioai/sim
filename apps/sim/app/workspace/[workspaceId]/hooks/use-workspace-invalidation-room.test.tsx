/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import type { RoomType } from '@sim/realtime-protocol/rooms'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseSocket } = vi.hoisted(() => ({ mockUseSocket: vi.fn() }))

vi.mock('@/app/workspace/providers/socket-provider', () => ({
  useSocket: () => mockUseSocket(),
}))

import {
  INVALIDATION_COALESCE_MS,
  useWorkspaceInvalidationRoom,
} from '@/app/workspace/[workspaceId]/hooks/use-workspace-invalidation-room'

function fakeSocket() {
  return { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() }
}

let socket: ReturnType<typeof fakeSocket>
const roots: Root[] = []

function mount(
  workspaceId: string,
  roomType: RoomType,
  onChanged: () => unknown = () => {},
  dedupeKey?: string
): Root {
  function Probe() {
    useWorkspaceInvalidationRoom(workspaceId, roomType, onChanged, dedupeKey)
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(<Probe />))
  roots.push(root)
  return root
}

function unmount(root: Root) {
  act(() => root.unmount())
}

/** Delivers a `${roomType}-changed` broadcast to the handler the room registered. */
function broadcast(event: string, workspaceId: string) {
  for (const [name, handler] of socket.on.mock.calls) if (name === event) handler({ workspaceId })
}

const emitted = (event: string, workspaceId?: string) =>
  socket.emit.mock.calls.filter(
    ([name, payload]) =>
      name === event && (workspaceId === undefined || payload?.workspaceId === workspaceId)
  ).length

describe('useWorkspaceInvalidationRoom', () => {
  beforeEach(() => {
    socket = fakeSocket()
    mockUseSocket.mockImplementation(() => ({ socket }))
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      try {
        unmount(root)
      } catch {
        /* already unmounted by the test */
      }
    }
  })

  /*
   * An editor can show several folder pickers, each subscribing to the same
   * room. Without reference counting the first to unmount emitted `leave` and
   * evicted the socket, so its still-mounted siblings silently stopped
   * receiving updates.
   */
  it('does not leave while another subscriber is still mounted', () => {
    const first = mount('ws-1', 'workspace-files')
    mount('ws-1', 'workspace-files')

    unmount(first)

    expect(emitted('leave-workspace-files')).toBe(0)
  })

  it('leaves a room whose own subscriber went, while another room is still held', () => {
    const files = mount('ws-1', 'workspace-files')
    mount('ws-1', 'workspace-tables')

    unmount(files)

    expect(emitted('leave-workspace-files')).toBe(1)
    expect(emitted('leave-workspace-tables')).toBe(0)
  })

  it('does not let one workspace hold another open', () => {
    const a = mount('ws-1', 'workspace-files')
    mount('ws-2', 'workspace-files')

    unmount(a)

    expect(emitted('leave-workspace-files', 'ws-1')).toBe(1)
  })

  describe('change delivery', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('delivers a burst of broadcasts once at once and once after it, not once per broadcast', async () => {
      const onChanged = vi.fn()
      mount('ws-1', 'workspace-files', onChanged)

      for (let index = 0; index < 20; index++) broadcast('workspace-files-changed', 'ws-1')
      await vi.advanceTimersByTimeAsync(0)
      expect(onChanged).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(INVALIDATION_COALESCE_MS)
      expect(onChanged).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(10 * INVALIDATION_COALESCE_MS)
      expect(onChanged).toHaveBeenCalledTimes(2)
    })

    it('waits for a refetch in flight instead of starting another beside it', async () => {
      let settle: () => void = () => {}
      const onChanged = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve
          })
      )
      mount('ws-1', 'workspace-files', onChanged)

      broadcast('workspace-files-changed', 'ws-1')
      await vi.advanceTimersByTimeAsync(5 * INVALIDATION_COALESCE_MS)
      broadcast('workspace-files-changed', 'ws-1')
      await vi.advanceTimersByTimeAsync(5 * INVALIDATION_COALESCE_MS)
      expect(onChanged).toHaveBeenCalledTimes(1)

      settle()
      await vi.advanceTimersByTimeAsync(INVALIDATION_COALESCE_MS)
      expect(onChanged).toHaveBeenCalledTimes(2)
    })
  })
})
