import { describe, expect, it, vi } from 'vitest'

const { mockResolveRole } = vi.hoisted(() => ({
  mockResolveRole: vi.fn(),
}))

vi.mock('@/middleware/permissions', () => ({
  resolveCurrentRoomPermission: mockResolveRole,
  ROLE_REVALIDATION_TTL_MS: 30_000,
}))

import {
  ACCESS_REVALIDATION_SWEEP_INTERVAL_MS,
  startAccessRevalidationSweep,
} from '@/access-revalidation'
import type { IRoomManager, UserPresence } from '@/rooms'

interface FakeSocket {
  id: string
  userId?: string
  rooms: Set<string>
  emit: ReturnType<typeof vi.fn>
  leave: ReturnType<typeof vi.fn>
}

function makeSocket(id: string, userId: string | undefined, room?: string): FakeSocket {
  const rooms = new Set<string>([id])
  if (room) rooms.add(room)
  return {
    id,
    userId,
    rooms,
    emit: vi.fn(),
    // Socket.IO's leave removes the room from `rooms` synchronously.
    leave: vi.fn((room: string) => {
      rooms.delete(room)
    }),
  }
}

function makeManager(sockets: FakeSocket[], presence: Partial<UserPresence>[] = []) {
  const socketMap = new Map(sockets.map((s) => [s.id, s]))
  const manager = {
    io: { sockets: { sockets: socketMap } },
    isReady: () => true,
    getRoomUsers: vi.fn().mockResolvedValue(presence),
    getRoomForSocket: vi.fn().mockResolvedValue(null),
    removeUserFromRoom: vi.fn().mockResolvedValue(true),
    broadcastPresenceUpdate: vi.fn().mockResolvedValue(undefined),
  }
  return manager as unknown as IRoomManager & {
    getRoomUsers: ReturnType<typeof vi.fn>
    getRoomForSocket: ReturnType<typeof vi.fn>
    removeUserFromRoom: ReturnType<typeof vi.fn>
    broadcastPresenceUpdate: ReturnType<typeof vi.fn>
  }
}

describe('access-revalidation sweep', () => {
  it('evicts a socket whose role has been revoked', async () => {
    const socket = makeSocket('sock-1', 'user-1', 'wf-1')
    const manager = makeManager([socket], [{ socketId: 'sock-1', role: 'read' }])
    mockResolveRole.mockResolvedValue(null)

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    expect(socket.emit).toHaveBeenCalledWith(
      'access-revoked',
      expect.objectContaining({ workflowId: 'wf-1' })
    )
    expect(socket.leave).toHaveBeenCalledWith('wf-1')
    expect(manager.removeUserFromRoom).toHaveBeenCalledWith(
      { type: 'workflow', id: 'wf-1' },
      'sock-1'
    )
    expect(manager.broadcastPresenceUpdate).toHaveBeenCalledWith({ type: 'workflow', id: 'wf-1' })
  })

  it('does not evict a downgraded-but-still-authorized socket', async () => {
    const socket = makeSocket('sock-1', 'user-1', 'wf-1')
    const manager = makeManager([socket], [{ socketId: 'sock-1', role: 'admin' }])
    // Downgraded admin -> read still resolves to a non-null role: keep the reader.
    mockResolveRole.mockResolvedValue('read')

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    expect(socket.emit).not.toHaveBeenCalled()
    expect(socket.leave).not.toHaveBeenCalled()
  })

  it('never evicts when re-validation throws (transient failure)', async () => {
    const socket = makeSocket('sock-1', 'user-1', 'wf-1')
    const manager = makeManager([socket], [{ socketId: 'sock-1', role: 'read' }])
    mockResolveRole.mockRejectedValue(new Error('db unreachable'))

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    expect(socket.emit).not.toHaveBeenCalled()
    expect(socket.leave).not.toHaveBeenCalled()
    expect(manager.removeUserFromRoom).not.toHaveBeenCalled()
  })

  it('sweeps non-workflow rooms against their own resource, not a bogus workflow id', async () => {
    // The sweep shares one io with the files/tables/file-doc handlers. Their rooms are
    // namespaced (`workspace-files:ws-1`, `table:t-1`), so each name is decoded and
    // authorized as its own room type — the whole point of covering them at all.
    const filesSocket = makeSocket('sock-1', 'user-1', 'workspace-files:ws-1')
    const tableSocket = makeSocket('sock-2', 'user-2', 'table:t-1')
    const manager = makeManager([filesSocket, tableSocket])
    mockResolveRole.mockResolvedValue('write')

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    expect(mockResolveRole).toHaveBeenCalledWith(
      'user-1',
      { type: 'workspace-files', id: 'ws-1' },
      'read'
    )
    expect(mockResolveRole).toHaveBeenCalledWith('user-2', { type: 'table', id: 't-1' }, 'read')
    // Still authorized: nobody is evicted.
    expect(filesSocket.leave).not.toHaveBeenCalled()
    expect(tableSocket.leave).not.toHaveBeenCalled()
  })

  it('evicts a file-doc socket downgraded to read, and keeps its table room', async () => {
    // A file-doc room IS the editor and requires `write`; a table room requires only
    // `read`. One downgraded user in both rooms must lose exactly the document.
    const socket = makeSocket('sock-1', 'user-1', 'workspace-file-doc:file-1')
    socket.rooms.add('table:t-1')
    const manager = makeManager([socket])
    mockResolveRole.mockResolvedValue('read')

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    expect(socket.leave).toHaveBeenCalledWith('workspace-file-doc:file-1')
    expect(socket.leave).not.toHaveBeenCalledWith('table:t-1')
    expect(socket.emit).toHaveBeenCalledWith(
      'room-access-revoked',
      expect.objectContaining({ room: { type: 'workspace-file-doc', id: 'file-1' } })
    )
  })

  it('falls back to the room type own membership level on a cold-cache failure', async () => {
    // A static 'read' fallback would have evicted every file-doc socket (which needs
    // `write`) the first time the DB blipped with a cold cache.
    const socket = makeSocket('sock-1', 'user-1', 'workspace-file-doc:file-1')
    const manager = makeManager([socket])
    mockResolveRole.mockResolvedValue('write')

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    expect(mockResolveRole).toHaveBeenCalledWith(
      'user-1',
      { type: 'workspace-file-doc', id: 'file-1' },
      'write'
    )
    expect(socket.leave).not.toHaveBeenCalled()
  })

  it('evicts only the revoked socket, not co-members of the room', async () => {
    const revoked = makeSocket('sock-1', 'user-1', 'wf-1')
    const kept = makeSocket('sock-2', 'user-2', 'wf-1')
    const manager = makeManager(
      [revoked, kept],
      [
        { socketId: 'sock-1', role: 'read' },
        { socketId: 'sock-2', role: 'write' },
      ]
    )
    mockResolveRole.mockImplementation(async (userId: string) =>
      userId === 'user-1' ? null : 'write'
    )

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    expect(revoked.leave).toHaveBeenCalledWith('wf-1')
    expect(kept.leave).not.toHaveBeenCalled()
    expect(kept.emit).not.toHaveBeenCalled()
  })

  it('defers failed room-state cleanup and retries it on the next pass', async () => {
    const socket = makeSocket('sock-1', 'user-1', 'wf-1')
    const manager = makeManager([socket], [{ socketId: 'sock-1', role: 'read' }])
    manager.removeUserFromRoom.mockRejectedValueOnce(new Error('redis down'))
    mockResolveRole.mockResolvedValue(null)

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()

    expect(socket.leave).toHaveBeenCalledWith('wf-1')
    expect(manager.broadcastPresenceUpdate).not.toHaveBeenCalled()

    // The evicted socket left the room, so membership scans no longer see it —
    // the retry queue must drive the cleanup to completion.
    await sweep.runOnce()
    sweep.stop()

    expect(manager.removeUserFromRoom).toHaveBeenCalledTimes(2)
    expect(manager.broadcastPresenceUpdate).toHaveBeenCalledWith({ type: 'workflow', id: 'wf-1' })
  })

  it('skips a socket whose authorization query hangs and still evicts the rest', async () => {
    vi.useFakeTimers()
    try {
      const hung = makeSocket('sock-1', 'user-1', 'wf-1')
      const revoked = makeSocket('sock-2', 'user-2', 'wf-1')
      const manager = makeManager([hung, revoked])
      // user-1's authorization query hangs (wedged DB connection); user-2's
      // resolves to a confirmed revocation.
      mockResolveRole.mockImplementation(async (userId: string) => {
        if (userId === 'user-1') return new Promise(() => {})
        return null
      })

      const sweep = startAccessRevalidationSweep(manager)

      // First tick starts the scan; the per-socket timeout fires at +5s and the
      // scan moves on to evict the revoked socket in the same pass.
      await vi.advanceTimersByTimeAsync(ACCESS_REVALIDATION_SWEEP_INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(10_000)

      expect(hung.leave).not.toHaveBeenCalled()
      expect(revoked.leave).toHaveBeenCalledWith('wf-1')

      // The next tick's scan still runs — the hung query did not wedge the lane.
      const callsAfterFirstPass = mockResolveRole.mock.calls.length
      await vi.advanceTimersByTimeAsync(ACCESS_REVALIDATION_SWEEP_INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(10_000)
      sweep.stop()

      expect(mockResolveRole.mock.calls.length).toBeGreaterThan(callsAfterFirstPass)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rotates the scan start so hung checks cannot starve later sockets', async () => {
    vi.useFakeTimers()
    try {
      // Four hung authorization checks consume exactly the 20s pass budget
      // (4 × 5s per-socket timeout); the revoked socket sits behind them.
      const hungSockets = [1, 2, 3, 4].map((i) => makeSocket(`sock-${i}`, `user-${i}`, 'wf-1'))
      const revoked = makeSocket('sock-5', 'user-5', 'wf-1')
      const manager = makeManager([...hungSockets, revoked])
      mockResolveRole.mockImplementation(async (userId: string) => {
        if (userId === 'user-5') return null
        return new Promise(() => {})
      })

      const sweep = startAccessRevalidationSweep(manager)

      // First pass burns its whole budget on the hung prefix.
      await vi.advanceTimersByTimeAsync(ACCESS_REVALIDATION_SWEEP_INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(25_000)
      expect(revoked.leave).not.toHaveBeenCalled()

      // Second pass resumes after the last processed socket, so the revoked
      // socket is examined first and evicted.
      await vi.advanceTimersByTimeAsync(10_000)
      sweep.stop()

      expect(revoked.leave).toHaveBeenCalledWith('wf-1')
    } finally {
      vi.useRealTimers()
    }
  })
})
