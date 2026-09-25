import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { TABLE_PRESENCE_EVENTS } from '@sim/realtime-protocol/table-presence'
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IRoomManager } from '@/rooms'

const { mockAuthorizeRoom } = vi.hoisted(() => ({
  mockAuthorizeRoom: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { select: vi.fn() },
  user: { image: 'image' },
}))

vi.mock('@sim/platform-authz/rooms', () => ({
  authorizeRoom: mockAuthorizeRoom,
}))

import { setEvictionCleanupSink } from '@/handlers/room-eviction'
import { setupTablesHandlers } from '@/handlers/tables'
import { beginRoomPermissionRead, commitRoomPermission } from '@/middleware/permissions'

const TABLE_ROOM = { type: ROOM_TYPES.TABLE, id: 'table-1' }

function createSocket(overrides?: Record<string, unknown>) {
  const handlers: Record<string, (payload: unknown) => Promise<void> | void> = {}
  const toEmit = vi.fn()
  const socket = {
    id: 'socket-1',
    userId: 'user-1',
    userName: 'Test User',
    userImage: 'avatar.png',
    on: vi.fn((event: string, handler: (payload: unknown) => Promise<void> | void) => {
      handlers[event] = handler
    }),
    emit: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    to: vi.fn().mockReturnValue({ emit: toEmit }),
    ...overrides,
  }
  return { handlers, socket, toEmit }
}

function createRoomManager(overrides?: Partial<IRoomManager>): IRoomManager {
  return {
    isReady: vi.fn().mockReturnValue(true),
    getRoomForSocket: vi.fn().mockResolvedValue(null),
    getRoomsForSocket: vi.fn().mockResolvedValue([]),
    removeUserFromRoom: vi.fn().mockResolvedValue(false),
    removeSocketFromAllRooms: vi.fn().mockResolvedValue([]),
    broadcastPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    getRoomUsers: vi.fn().mockResolvedValue([]),
    hasRoom: vi.fn().mockResolvedValue(false),
    deleteRoom: vi.fn().mockResolvedValue(undefined),
    addUserToRoom: vi.fn().mockResolvedValue(undefined),
    getUserSession: vi.fn().mockResolvedValue(null),
    updateUserActivity: vi.fn().mockResolvedValue(undefined),
    updateRoomLastModified: vi.fn().mockResolvedValue(undefined),
    emitToRoom: vi.fn(),
    getUniqueUserCount: vi.fn().mockResolvedValue(1),
    getTotalActiveConnections: vi.fn().mockResolvedValue(0),
    shutdown: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    io: {
      in: vi.fn().mockReturnValue({ socketsLeave: vi.fn().mockResolvedValue(undefined) }),
    },
    ...overrides,
  } as unknown as IRoomManager
}

type SetupArg = Parameters<typeof setupTablesHandlers>[0]

describe('setupTablesHandlers', () => {
  beforeEach(() => {
    mockAuthorizeRoom.mockResolvedValue({
      allowed: true,
      status: 200,
      workspaceId: 'ws-1',
      workspacePermission: 'admin',
    })
  })

  it('rejects join when table access is denied', async () => {
    mockAuthorizeRoom.mockResolvedValue({
      allowed: false,
      status: 403,
      workspaceId: 'ws-1',
      workspacePermission: null,
    })
    const { socket, handlers } = createSocket()
    setupTablesHandlers(socket as unknown as SetupArg, createRoomManager())

    await handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-1' })

    expect(socket.emit).toHaveBeenCalledWith(
      TABLE_PRESENCE_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'ACCESS_DENIED', retryable: false })
    )
  })

  it('does not join when access was revoked while the join was in flight', async () => {
    // The sweep records a revocation before it evicts, so a join whose authorize
    // completed just before that must not put the socket back in the room.
    const { socket, handlers } = createSocket({ id: 'socket-race', userId: 'user-race' })
    const roomManager = createRoomManager()
    setupTablesHandlers(socket as unknown as SetupArg, roomManager)

    mockAuthorizeRoom.mockImplementation(async () => {
      commitRoomPermission(
        'user-race',
        { type: ROOM_TYPES.TABLE, id: 'table-race' },
        null,
        beginRoomPermissionRead()
      )
      return { allowed: true, status: 200, workspaceId: 'ws-1', workspacePermission: 'admin' }
    })

    await handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-race' })

    expect(socket.emit).toHaveBeenCalledWith(
      TABLE_PRESENCE_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'ACCESS_DENIED', retryable: false })
    )
    expect(socket.join).not.toHaveBeenCalled()
    expect(roomManager.addUserToRoom).not.toHaveBeenCalled()
  })

  it('drops a cell selection and evicts once the viewer loses access mid-session', async () => {
    // Distinct user/table so the recorded revocation cannot leak into sibling tests
    // through the module-global role cache.
    vi.useFakeTimers()
    try {
      const room = { type: ROOM_TYPES.TABLE, id: 'table-revoked' }
      const { socket, handlers, toEmit } = createSocket({ id: 'socket-9', userId: 'user-9' })
      const roomManager = createRoomManager({
        getRoomForSocket: vi.fn().mockResolvedValue(room),
      })
      setupTablesHandlers(socket as unknown as SetupArg, roomManager)

      await handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-revoked' })
      await vi.advanceTimersByTimeAsync(0)

      // Access removed, and the join-time decision expires.
      mockAuthorizeRoom.mockResolvedValue({
        allowed: false,
        status: 403,
        workspaceId: 'ws-1',
        workspacePermission: null,
      })
      await vi.advanceTimersByTimeAsync(31_000)

      const cell = {
        anchor: { rowId: 'row-1', columnId: 'col-a' },
        focus: { rowId: 'row-1', columnId: 'col-a' },
      }
      // First selection after expiry finds nothing cached: accepted, and it kicks off the
      // authoritative re-read rather than blocking the relay on a DB round-trip.
      await handlers[TABLE_PRESENCE_EVENTS.CELL_SELECTION]({ cell })
      await vi.advanceTimersByTimeAsync(0)

      toEmit.mockClear()
      await handlers[TABLE_PRESENCE_EVENTS.CELL_SELECTION]({ cell })
      await vi.advanceTimersByTimeAsync(0)

      expect(toEmit).not.toHaveBeenCalled()
      expect(socket.emit).toHaveBeenCalledWith(
        'room-access-revoked',
        expect.objectContaining({ room })
      )
      expect(socket.leave).toHaveBeenCalledWith('table:table-revoked')
      expect(roomManager.removeUserFromRoom).toHaveBeenCalledWith(room, 'socket-9')
    } finally {
      vi.useRealTimers()
    }
  })

  it('hands a failed presence removal to the sweep so the eviction stays retryable', async () => {
    // The eviction already left the Socket.IO room, so the sweep's scan can no longer
    // rediscover this socket — a failed removal here would strand a ghost collaborator
    // until disconnect unless it is handed to the retrying cleanup lane.
    vi.useFakeTimers()
    const owed: Array<{ socketId: string; roomId: string }> = []
    setEvictionCleanupSink((socketId, room) => owed.push({ socketId, roomId: room.id }))
    try {
      const room = { type: ROOM_TYPES.TABLE, id: 'table-defer' }
      const { socket, handlers } = createSocket({ id: 'socket-defer', userId: 'user-defer' })
      const roomManager = createRoomManager({
        getRoomForSocket: vi.fn().mockResolvedValue(room),
        removeUserFromRoom: vi.fn().mockRejectedValue(new Error('redis down')),
      })
      setupTablesHandlers(socket as unknown as SetupArg, roomManager)

      await handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-defer' })
      await vi.advanceTimersByTimeAsync(0)

      mockAuthorizeRoom.mockResolvedValue({
        allowed: false,
        status: 403,
        workspaceId: 'ws-1',
        workspacePermission: null,
      })
      await vi.advanceTimersByTimeAsync(31_000)

      const cell = {
        anchor: { rowId: 'row-1', columnId: 'col-a' },
        focus: { rowId: 'row-1', columnId: 'col-a' },
      }
      await handlers[TABLE_PRESENCE_EVENTS.CELL_SELECTION]({ cell })
      await vi.advanceTimersByTimeAsync(0)
      await handlers[TABLE_PRESENCE_EVENTS.CELL_SELECTION]({ cell })
      await vi.advanceTimersByTimeAsync(0)

      expect(socket.leave).toHaveBeenCalledWith('table:table-defer')
      expect(owed).toEqual([{ socketId: 'socket-defer', roomId: 'table-defer' }])
    } finally {
      setEvictionCleanupSink(null)
      vi.useRealTimers()
    }
  })

  it('keeps the prior table room when a switch is denied at the access re-check', async () => {
    // A denied switch must not silently drop the client from a table it may still be
    // allowed to occupy, so the prior room is left only once the join is certain.
    vi.useFakeTimers()
    try {
      const prior = { type: ROOM_TYPES.TABLE, id: 'table-prior' }
      const { socket, handlers } = createSocket({ id: 'socket-switch', userId: 'user-switch' })
      const roomManager = createRoomManager({
        getRoomForSocket: vi.fn().mockResolvedValue(prior),
      })
      setupTablesHandlers(socket as unknown as SetupArg, roomManager)

      let call = 0
      mockAuthorizeRoom.mockImplementation(async () => {
        call += 1
        if (call === 1) {
          // A later-started read drops this join's own decision, and the join stalls past
          // the TTL so that decision is expired by re-check time — forcing the re-resolve
          // down its database path below.
          commitRoomPermission(
            'user-switch',
            { type: ROOM_TYPES.TABLE, id: 'table-target' },
            'admin',
            beginRoomPermissionRead()
          )
          await sleep(31_000)
          return { allowed: true, status: 200, workspaceId: 'ws-1', workspacePermission: 'admin' }
        }
        // The authoritative current answer: access is gone.
        return { allowed: false, status: 403, workspaceId: 'ws-1', workspacePermission: null }
      })

      const joining = handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-target' })
      await vi.advanceTimersByTimeAsync(31_000)
      await joining

      expect(socket.emit).toHaveBeenCalledWith(
        TABLE_PRESENCE_EVENTS.JOIN_ERROR,
        expect.objectContaining({ code: 'ACCESS_DENIED', retryable: false })
      )
      // Neither joined the target nor abandoned the prior room.
      expect(socket.join).not.toHaveBeenCalled()
      expect(socket.leave).not.toHaveBeenCalled()
      expect(roomManager.removeUserFromRoom).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rolls back the Socket.IO membership when a join fails mid-commit', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager({
      // socket.join lands first, then the presence write throws — the socket is now in the
      // Socket.IO room with no matching socket→room map entry, unreclaimable by any later op.
      addUserToRoom: vi.fn().mockRejectedValue(new Error('redis down')),
    })
    setupTablesHandlers(socket as unknown as SetupArg, roomManager)

    await handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-1' })

    // The catch must always roll back the partial membership, not skip it.
    expect(socket.leave).toHaveBeenCalledWith('table:table-1')
    expect(roomManager.removeUserFromRoom).toHaveBeenCalledWith(TABLE_ROOM, 'socket-1')
    expect(socket.emit).toHaveBeenCalledWith(
      TABLE_PRESENCE_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'JOIN_FAILED' })
    )
  })
})
