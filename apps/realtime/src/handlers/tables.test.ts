/**
 * @vitest-environment node
 */
import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { TABLE_PRESENCE_EVENTS } from '@sim/realtime-protocol/table-presence'
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

import { setupTablesHandlers } from '@/handlers/tables'

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
})
