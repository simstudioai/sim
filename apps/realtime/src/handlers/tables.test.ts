/**
 * @vitest-environment node
 */
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
    vi.clearAllMocks()
    mockAuthorizeRoom.mockResolvedValue({
      allowed: true,
      status: 200,
      workspaceId: 'ws-1',
      workspacePermission: 'admin',
    })
  })

  it('rejects join when the socket is not authenticated', async () => {
    const { socket, handlers } = createSocket({ userId: undefined, userName: undefined })
    setupTablesHandlers(socket as unknown as SetupArg, createRoomManager())

    await handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-1' })

    expect(socket.emit).toHaveBeenCalledWith(TABLE_PRESENCE_EVENTS.JOIN_ERROR, {
      tableId: 'table-1',
      error: 'Authentication required',
      code: 'AUTHENTICATION_REQUIRED',
      retryable: false,
    })
  })

  it('rejects join with a retryable error when realtime is unavailable', async () => {
    const { socket, handlers } = createSocket()
    setupTablesHandlers(
      socket as unknown as SetupArg,
      createRoomManager({ isReady: vi.fn().mockReturnValue(false) })
    )

    await handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-1' })

    expect(socket.emit).toHaveBeenCalledWith(
      TABLE_PRESENCE_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'ROOM_MANAGER_UNAVAILABLE', retryable: true })
    )
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

  it('joins the table room and broadcasts presence on success', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()
    setupTablesHandlers(socket as unknown as SetupArg, roomManager)

    await handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-1', tabSessionId: 'tab-1' })

    expect(socket.join).toHaveBeenCalledWith('table:table-1')
    expect(roomManager.addUserToRoom).toHaveBeenCalledWith(
      TABLE_ROOM,
      'socket-1',
      expect.objectContaining({ userId: 'user-1', role: 'admin' })
    )
    expect(socket.emit).toHaveBeenCalledWith(
      TABLE_PRESENCE_EVENTS.JOIN_SUCCESS,
      expect.objectContaining({ tableId: 'table-1', socketId: 'socket-1' })
    )
    expect(roomManager.broadcastPresenceUpdate).toHaveBeenCalledWith(TABLE_ROOM)
  })

  it('persists and relays a cell selection to the namespaced room (id + cell only)', async () => {
    const { socket, handlers, toEmit } = createSocket()
    const roomManager = createRoomManager({
      getRoomForSocket: vi.fn().mockResolvedValue(TABLE_ROOM),
    })
    setupTablesHandlers(socket as unknown as SetupArg, roomManager)

    const cell = {
      anchor: { rowId: 'row-1', columnId: 'col-a' },
      focus: { rowId: 'row-1', columnId: 'col-a' },
      editing: true,
    }
    await handlers[TABLE_PRESENCE_EVENTS.CELL_SELECTION]({ cell })

    expect(roomManager.updateUserActivity).toHaveBeenCalledWith(TABLE_ROOM, 'socket-1', { cell })
    // Namespaced room → broadcast targets roomName(room), not the bare id.
    expect(socket.to).toHaveBeenCalledWith('table:table-1')
    // The delta carries only the socket id + cell — identity comes from the roster.
    expect(toEmit).toHaveBeenCalledWith(TABLE_PRESENCE_EVENTS.CELL_SELECTION, {
      socketId: 'socket-1',
      cell,
    })
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

  it('aborts the join when a revocation lands during the prior-room leave', async () => {
    // The prior-room leave is the only await left between the authoritative access
    // re-check and the commit, so a sweep revocation recorded in that window must still
    // stop the join — `superseded()` alone only watches the join generation.
    const prior = { type: ROOM_TYPES.TABLE, id: 'table-prior-2' }
    const target = { type: ROOM_TYPES.TABLE, id: 'table-target-2' }
    const { socket, handlers } = createSocket({ id: 'socket-window', userId: 'user-window' })
    const roomManager = createRoomManager({
      getRoomForSocket: vi.fn().mockResolvedValue(prior),
      removeUserFromRoom: vi.fn().mockImplementation(async () => {
        // The sweep records the revocation while the prior-room leave is in flight.
        commitRoomPermission('user-window', target, null, beginRoomPermissionRead())
        return true
      }),
    })
    setupTablesHandlers(socket as unknown as SetupArg, roomManager)

    await handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-target-2' })

    expect(socket.emit).toHaveBeenCalledWith(
      TABLE_PRESENCE_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'ACCESS_DENIED', retryable: false })
    )
    expect(socket.join).not.toHaveBeenCalled()
    expect(roomManager.addUserToRoom).not.toHaveBeenCalled()
  })

  it('drops a malformed cell selection without storing or relaying it', async () => {
    const { socket, handlers, toEmit } = createSocket()
    const roomManager = createRoomManager({
      getRoomForSocket: vi.fn().mockResolvedValue(TABLE_ROOM),
    })
    setupTablesHandlers(socket as unknown as SetupArg, roomManager)

    await handlers[TABLE_PRESENCE_EVENTS.CELL_SELECTION]({ cell: { anchor: 'x"]' } })

    expect(roomManager.updateUserActivity).not.toHaveBeenCalled()
    expect(toEmit).not.toHaveBeenCalled()
  })

  it('strips unknown/oversized fields from an otherwise-valid selection before storing or relaying', async () => {
    const { socket, handlers, toEmit } = createSocket()
    const roomManager = createRoomManager({
      getRoomForSocket: vi.fn().mockResolvedValue(TABLE_ROOM),
    })
    setupTablesHandlers(socket as unknown as SetupArg, roomManager)

    await handlers[TABLE_PRESENCE_EVENTS.CELL_SELECTION]({
      cell: {
        anchor: { rowId: 'row-1', columnId: 'col-a', junk: 'x'.repeat(10_000) },
        focus: { rowId: 'row-1', columnId: 'col-a' },
        editing: true,
        bloat: 'x'.repeat(100_000),
      },
    })

    // Only the whitelisted fields survive — a hostile peer can't amplify an oversized object.
    const expected = {
      anchor: { rowId: 'row-1', columnId: 'col-a' },
      focus: { rowId: 'row-1', columnId: 'col-a' },
      editing: true,
    }
    expect(roomManager.updateUserActivity).toHaveBeenCalledWith(TABLE_ROOM, 'socket-1', {
      cell: expected,
    })
    expect(toEmit).toHaveBeenCalledWith(TABLE_PRESENCE_EVENTS.CELL_SELECTION, {
      socketId: 'socket-1',
      cell: expected,
    })
  })

  it('skips a superseded queued join on a fast table switch', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()
    mockAuthorizeRoom.mockResolvedValue({
      allowed: true,
      status: 200,
      workspaceId: 'ws-1',
      workspacePermission: 'admin',
    })
    setupTablesHandlers(socket as unknown as SetupArg, roomManager)

    // Two joins enqueued back-to-back (A then B). B bumps the generation synchronously, so A's
    // queued run no-ops at its start check — only B commits. Because JOINs are serialized on one
    // op chain, A's and B's Redis writes can never interleave (no map-clobber, no stranding).
    handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-A' })
    await handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-B' })

    expect(socket.join).toHaveBeenCalledWith('table:table-B')
    expect(socket.join).not.toHaveBeenCalledWith('table:table-A')
    expect(roomManager.addUserToRoom).toHaveBeenCalledWith(
      { type: ROOM_TYPES.TABLE, id: 'table-B' },
      'socket-1',
      expect.anything()
    )
    expect(roomManager.addUserToRoom).not.toHaveBeenCalledWith(
      { type: ROOM_TYPES.TABLE, id: 'table-A' },
      expect.anything(),
      expect.anything()
    )
  })

  it('aborts an in-flight join when a leave for that table arrives during authorize', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()
    let releaseAuth: (value: unknown) => void = () => {}
    const pending = new Promise((resolve) => {
      releaseAuth = resolve
    })
    mockAuthorizeRoom.mockReturnValueOnce(pending)
    setupTablesHandlers(socket as unknown as SetupArg, roomManager)

    const joinPromise = handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-1' })
    // Client navigates away while the join is still awaiting authorization.
    await handlers[TABLE_PRESENCE_EVENTS.LEAVE]({ tableId: 'table-1' })
    releaseAuth({ allowed: true, status: 200, workspaceId: 'ws-1', workspacePermission: 'admin' })
    await joinPromise

    // The cancelled join must touch no room state — the socket is not stranded.
    expect(socket.join).not.toHaveBeenCalled()
    expect(roomManager.addUserToRoom).not.toHaveBeenCalled()
    expect(roomManager.broadcastPresenceUpdate).not.toHaveBeenCalledWith(TABLE_ROOM)
  })

  it('aborts an in-flight join when an unscoped leave arrives during authorize', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()
    let releaseAuth: (value: unknown) => void = () => {}
    const pending = new Promise((resolve) => {
      releaseAuth = resolve
    })
    mockAuthorizeRoom.mockReturnValueOnce(pending)
    setupTablesHandlers(socket as unknown as SetupArg, roomManager)

    const joinPromise = handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-1' })
    // A leave with no table id (view teardown) must also cancel the in-flight join.
    await handlers[TABLE_PRESENCE_EVENTS.LEAVE](undefined)
    releaseAuth({ allowed: true, status: 200, workspaceId: 'ws-1', workspacePermission: 'admin' })
    await joinPromise

    expect(socket.join).not.toHaveBeenCalled()
    expect(roomManager.addUserToRoom).not.toHaveBeenCalled()
  })

  it('does not abort an in-flight join when a leave targets a different table', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()
    let releaseAuth: (value: unknown) => void = () => {}
    const pending = new Promise((resolve) => {
      releaseAuth = resolve
    })
    mockAuthorizeRoom.mockReturnValueOnce(pending)
    setupTablesHandlers(socket as unknown as SetupArg, roomManager)

    const joinPromise = handlers[TABLE_PRESENCE_EVENTS.JOIN]({ tableId: 'table-B' })
    // A stale/deferred leave for a table the client already left must NOT cancel the B join.
    await handlers[TABLE_PRESENCE_EVENTS.LEAVE]({ tableId: 'table-A' })
    releaseAuth({ allowed: true, status: 200, workspaceId: 'ws-1', workspacePermission: 'admin' })
    await joinPromise

    expect(socket.join).toHaveBeenCalledWith('table:table-B')
    expect(roomManager.addUserToRoom).toHaveBeenCalledWith(
      { type: ROOM_TYPES.TABLE, id: 'table-B' },
      'socket-1',
      expect.anything()
    )
  })

  it('leaves the table room on leave', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager({
      getRoomForSocket: vi.fn().mockResolvedValue(TABLE_ROOM),
    })
    setupTablesHandlers(socket as unknown as SetupArg, roomManager)

    await handlers[TABLE_PRESENCE_EVENTS.LEAVE]({ tableId: 'table-1' })

    expect(socket.leave).toHaveBeenCalledWith('table:table-1')
    expect(roomManager.removeUserFromRoom).toHaveBeenCalledWith(TABLE_ROOM, 'socket-1')
    expect(roomManager.broadcastPresenceUpdate).toHaveBeenCalledWith(TABLE_ROOM, 'socket-1')
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
