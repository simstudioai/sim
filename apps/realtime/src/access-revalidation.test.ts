/**
 * @vitest-environment node
 *
 * Tests for the periodic read-access re-validation sweep. The security contract:
 * a socket is evicted only when its role resolves to `null` (a confirmed
 * revocation), and a transient failure never evicts a still-authorized socket.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveRole } = vi.hoisted(() => ({
  mockResolveRole: vi.fn(),
}))

vi.mock('@/middleware/permissions', () => ({
  resolveCurrentWorkflowRole: mockResolveRole,
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

function makeSocket(id: string, userId: string | undefined, workflowId?: string): FakeSocket {
  const rooms = new Set<string>([id])
  if (workflowId) rooms.add(workflowId)
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('keeps a socket whose access is still valid', async () => {
    const socket = makeSocket('sock-1', 'user-1', 'wf-1')
    const manager = makeManager([socket], [{ socketId: 'sock-1', role: 'write' }])
    mockResolveRole.mockResolvedValue('write')

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    expect(socket.emit).not.toHaveBeenCalled()
    expect(socket.leave).not.toHaveBeenCalled()
    expect(manager.removeUserFromRoom).not.toHaveBeenCalled()
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

  it('resolves with the static safe fallback and no presence reads in the scan', async () => {
    const socket = makeSocket('sock-1', 'user-1', 'wf-1')
    const manager = makeManager([socket], [{ socketId: 'sock-1', role: 'admin' }])
    mockResolveRole.mockResolvedValue('admin')

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    expect(mockResolveRole).toHaveBeenCalledWith('user-1', 'wf-1', 'read')
    // The security scan must stay Redis-free — presence is never consulted.
    expect(manager.getRoomUsers).not.toHaveBeenCalled()
  })

  it('never evicts a socket joined only to a non-workflow room (files/tables/file-doc)', async () => {
    // The sweep shares one io with the files/tables/file-doc handlers. Those rooms are
    // namespaced (`workspace-files:ws-1`, `table:t-1`), so treating every socket.rooms
    // entry as a workflow id would resolve a bogus permission → null → evict the socket
    // from its files/table room every pass. Non-workflow rooms must be filtered out.
    const filesSocket = makeSocket('sock-1', 'user-1', 'workspace-files:ws-1')
    const tableSocket = makeSocket('sock-2', 'user-2', 'table:t-1')
    const manager = makeManager([filesSocket, tableSocket])
    // Even if the role resolver would say "no access", these must never be swept.
    mockResolveRole.mockResolvedValue(null)

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    expect(mockResolveRole).not.toHaveBeenCalled()
    expect(filesSocket.leave).not.toHaveBeenCalled()
    expect(filesSocket.emit).not.toHaveBeenCalled()
    expect(tableSocket.leave).not.toHaveBeenCalled()
    expect(tableSocket.emit).not.toHaveBeenCalled()
    expect(manager.removeUserFromRoom).not.toHaveBeenCalled()
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

  it('skips unauthenticated sockets and sockets not in a workflow room', async () => {
    const noUser = makeSocket('sock-1', undefined, 'wf-1')
    const noRoom = makeSocket('sock-2', 'user-2')
    const manager = makeManager([noUser, noRoom])

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    expect(mockResolveRole).not.toHaveBeenCalled()
    expect(noUser.leave).not.toHaveBeenCalled()
    expect(noRoom.leave).not.toHaveBeenCalled()
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

  it('drops eviction cleanup when the socket is no longer mapped to the room (no infinite retry)', async () => {
    const socket = makeSocket('sock-1', 'user-1', 'wf-1')
    const manager = makeManager([socket], [{ socketId: 'sock-1', role: 'read' }])
    // A healthy lookup shows the socket is no longer mapped to any workflow room (its presence
    // is already gone), and removeUserFromRoom reports a no-op `false`. This is "already clean",
    // not a deferrable failure — the cleanup must drop it, never re-enqueue a still-connected
    // socket forever. (A genuine failure — still mapped + false — is covered by the next test.)
    manager.getRoomForSocket.mockResolvedValue(null)
    manager.removeUserFromRoom.mockResolvedValue(false)
    mockResolveRole.mockResolvedValue(null)

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    await sweep.runOnce()
    sweep.stop()

    // Attempted once, then dropped — not re-enqueued across passes, and no broadcast.
    expect(manager.removeUserFromRoom).toHaveBeenCalledTimes(1)
    expect(manager.broadcastPresenceUpdate).not.toHaveBeenCalled()
  })

  it('defers cleanup when the manager swallows a removal failure into null', async () => {
    const socket = makeSocket('sock-1', 'user-1', 'wf-1')
    const manager = makeManager([socket], [{ socketId: 'sock-1', role: 'read' }])
    // Live mapping but the removal reports nothing removed — the Redis manager
    // swallows transport errors into null, so this is the only failure signal.
    manager.getRoomForSocket.mockResolvedValue({ type: 'workflow', id: 'wf-1' })
    manager.removeUserFromRoom.mockResolvedValueOnce(false)
    mockResolveRole.mockResolvedValue(null)

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()

    expect(socket.leave).toHaveBeenCalledWith('wf-1')
    expect(manager.broadcastPresenceUpdate).not.toHaveBeenCalled()

    // Next pass: the removal now succeeds and the cleanup completes.
    await sweep.runOnce()
    sweep.stop()

    expect(manager.removeUserFromRoom).toHaveBeenCalledTimes(2)
    expect(manager.broadcastPresenceUpdate).toHaveBeenCalledWith({ type: 'workflow', id: 'wf-1' })
  })

  it('skips removal when the socket has since moved to a different workflow', async () => {
    const socket = makeSocket('sock-1', 'user-1', 'wf-1')
    const manager = makeManager([socket], [{ socketId: 'sock-1', role: 'read' }])
    // Between the membership snapshot and cleanup, the socket switched to a
    // workflow it can still access — removal must not touch its new presence.
    manager.getRoomForSocket.mockResolvedValue({ type: 'workflow', id: 'wf-2' })
    mockResolveRole.mockResolvedValue(null)

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    expect(socket.leave).toHaveBeenCalledWith('wf-1')
    expect(manager.removeUserFromRoom).not.toHaveBeenCalled()
    expect(manager.broadcastPresenceUpdate).not.toHaveBeenCalled()
  })

  it('drops a deferred cleanup when the socket legitimately re-joined the room', async () => {
    const socket = makeSocket('sock-1', 'user-1', 'wf-1')
    const manager = makeManager([socket], [{ socketId: 'sock-1', role: 'read' }])
    manager.removeUserFromRoom.mockRejectedValueOnce(new Error('redis down'))
    mockResolveRole.mockResolvedValueOnce(null)

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    expect(socket.leave).toHaveBeenCalledWith('wf-1')

    // Access restored and the socket re-joined the same room: the retry must
    // NOT remove the fresh presence entry that re-join created.
    socket.rooms.add('wf-1')
    mockResolveRole.mockResolvedValue('read')
    await sweep.runOnce()
    sweep.stop()

    expect(manager.removeUserFromRoom).toHaveBeenCalledTimes(1)
    expect(manager.broadcastPresenceUpdate).not.toHaveBeenCalled()
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

  it('keeps scanning on later ticks while a deferred cleanup hangs', async () => {
    vi.useFakeTimers()
    try {
      const socket = makeSocket('sock-1', 'user-1', 'wf-1')
      const manager = makeManager([socket], [{ socketId: 'sock-1', role: 'read' }])
      // A Redis outage where commands hang in the offline queue instead of
      // failing: the cleanup lane stalls, but scans must keep running.
      manager.getRoomForSocket.mockReturnValue(new Promise(() => {}))
      mockResolveRole.mockResolvedValue(null)

      const sweep = startAccessRevalidationSweep(manager)

      await vi.advanceTimersByTimeAsync(ACCESS_REVALIDATION_SWEEP_INTERVAL_MS)
      expect(socket.leave).toHaveBeenCalledWith('wf-1')
      const scansAfterFirstTick = mockResolveRole.mock.calls.length

      // Second socket appears while the first eviction's cleanup hangs.
      const second = makeSocket('sock-2', 'user-2', 'wf-1')
      const socketMap = manager.io.sockets.sockets as unknown as Map<string, FakeSocket>
      socketMap.set('sock-2', second)

      await vi.advanceTimersByTimeAsync(ACCESS_REVALIDATION_SWEEP_INTERVAL_MS)
      sweep.stop()

      // The hung cleanup did not block the next scan: the new socket was
      // evaluated and evicted.
      expect(mockResolveRole.mock.calls.length).toBeGreaterThan(scansAfterFirstTick)
      expect(second.leave).toHaveBeenCalledWith('wf-1')
    } finally {
      vi.useRealTimers()
    }
  })
})
