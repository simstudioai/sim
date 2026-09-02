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

import { useWorkspaceInvalidationRoom } from '@/app/workspace/[workspaceId]/hooks/use-workspace-invalidation-room'

function fakeSocket() {
  return { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() }
}

let socket: ReturnType<typeof fakeSocket>
const roots: Root[] = []

function mount(workspaceId: string, roomType: RoomType): Root {
  function Probe() {
    useWorkspaceInvalidationRoom(workspaceId, roomType, () => {})
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

const emitted = (event: string, workspaceId?: string) =>
  socket.emit.mock.calls.filter(
    ([name, payload]) =>
      name === event && (workspaceId === undefined || payload?.workspaceId === workspaceId)
  ).length

describe('useWorkspaceInvalidationRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('joins the room', () => {
    mount('ws-1', 'workspace-files')

    expect(emitted('join-workspace-files')).toBe(1)
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

  it('leaves once the last subscriber unmounts', () => {
    const first = mount('ws-1', 'workspace-files')
    const second = mount('ws-1', 'workspace-files')

    unmount(first)
    unmount(second)

    expect(emitted('leave-workspace-files')).toBe(1)
  })

  /* Counted per room, so holding one open does not hold another. */
  it('leaves a room whose own subscriber went, while another room is still held', () => {
    const files = mount('ws-1', 'workspace-files')
    mount('ws-1', 'workspace-tables')

    unmount(files)

    expect(emitted('leave-workspace-files')).toBe(1)
    expect(emitted('leave-workspace-tables')).toBe(0)
  })

  /* And per workspace, so one workspace cannot hold another one open. */
  it('does not let one workspace hold another open', () => {
    const a = mount('ws-1', 'workspace-files')
    mount('ws-2', 'workspace-files')

    unmount(a)

    expect(emitted('leave-workspace-files', 'ws-1')).toBe(1)
  })
})
