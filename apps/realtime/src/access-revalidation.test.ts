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

import { startAccessRevalidationSweep } from '@/access-revalidation'
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
  return { id, userId, rooms, emit: vi.fn(), leave: vi.fn() }
}

function makeManager(sockets: FakeSocket[], presence: Partial<UserPresence>[] = []) {
  const socketMap = new Map(sockets.map((s) => [s.id, s]))
  const manager = {
    io: { sockets: { sockets: socketMap } },
    isReady: () => true,
    getWorkflowUsers: vi.fn().mockResolvedValue(presence),
    removeUserFromRoom: vi.fn().mockResolvedValue(null),
    broadcastPresenceUpdate: vi.fn().mockResolvedValue(undefined),
  }
  return manager as unknown as IRoomManager & {
    getWorkflowUsers: ReturnType<typeof vi.fn>
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
    expect(manager.removeUserFromRoom).toHaveBeenCalledWith('sock-1', 'wf-1')
    expect(manager.broadcastPresenceUpdate).toHaveBeenCalledWith('wf-1')
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

  it('passes the join-time presence role as the fallback', async () => {
    const socket = makeSocket('sock-1', 'user-1', 'wf-1')
    const manager = makeManager([socket], [{ socketId: 'sock-1', role: 'admin' }])
    mockResolveRole.mockResolvedValue('admin')

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    expect(mockResolveRole).toHaveBeenCalledWith('user-1', 'wf-1', 'admin')
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

    // The evicted socket is out of the room now, so membership scans no longer
    // see it — the retry queue must drive the cleanup to completion.
    socket.rooms = new Set(['sock-1'])
    await sweep.runOnce()
    sweep.stop()

    expect(manager.removeUserFromRoom).toHaveBeenCalledTimes(2)
    expect(manager.broadcastPresenceUpdate).toHaveBeenCalledWith('wf-1')
  })

  it('drops a deferred cleanup when the socket legitimately re-joined the room', async () => {
    const socket = makeSocket('sock-1', 'user-1', 'wf-1')
    const manager = makeManager([socket], [{ socketId: 'sock-1', role: 'read' }])
    manager.removeUserFromRoom.mockRejectedValueOnce(new Error('redis down'))
    mockResolveRole.mockResolvedValueOnce(null)

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    expect(socket.leave).toHaveBeenCalledWith('wf-1')

    // Access restored and the socket re-joined (still in the room in this
    // fake): the retry must NOT remove the fresh presence entry.
    mockResolveRole.mockResolvedValue('read')
    await sweep.runOnce()
    sweep.stop()

    expect(manager.removeUserFromRoom).toHaveBeenCalledTimes(1)
    expect(manager.broadcastPresenceUpdate).not.toHaveBeenCalled()
  })

  it('still evaluates access when presence lookup fails (falls back safely)', async () => {
    const socket = makeSocket('sock-1', 'user-1', 'wf-1')
    const manager = makeManager([socket])
    manager.getWorkflowUsers.mockRejectedValue(new Error('redis down'))
    mockResolveRole.mockResolvedValue(null)

    const sweep = startAccessRevalidationSweep(manager)
    await sweep.runOnce()
    sweep.stop()

    // Presence unavailable → default fallback role, but the DB check still runs
    // and a confirmed revocation still evicts.
    expect(mockResolveRole).toHaveBeenCalledWith('user-1', 'wf-1', 'read')
    expect(socket.leave).toHaveBeenCalledWith('wf-1')
  })
})
