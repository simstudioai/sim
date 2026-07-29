/**
 * @vitest-environment node
 */
import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
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

import { setupWorkspaceInvalidationRoom } from '@/handlers/workspace-invalidation-room'

type Payload = { workspaceId?: string }

function createSocket(overrides?: Record<string, unknown>) {
  const handlers: Record<string, (payload?: Payload) => Promise<void> | void> = {}
  // Live Set so the handler's native `socket.rooms` membership tracking works in tests.
  const rooms = new Set<string>()
  const socket = {
    id: 'socket-1',
    userId: 'user-1',
    userName: 'Test User',
    userImage: 'avatar.png',
    rooms,
    on: vi.fn((event: string, handler: (payload?: Payload) => Promise<void> | void) => {
      handlers[event] = handler
    }),
    emit: vi.fn(),
    join: vi.fn((room: string) => rooms.add(room)),
    leave: vi.fn((room: string) => rooms.delete(room)),
    to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    ...overrides,
  }
  return { handlers, socket, rooms }
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

// The two presence-free live-list rooms share one implementation; run the whole suite against both
// so files and tables can never drift. Event names and room names derive from the room type.
describe.each([ROOM_TYPES.WORKSPACE_FILES, ROOM_TYPES.WORKSPACE_TABLES] as const)(
  'setupWorkspaceInvalidationRoom(%s)',
  (roomType) => {
    const joinEvent = `join-${roomType}`
    const successEvent = `${joinEvent}-success`
    const errorEvent = `${joinEvent}-error`
    const leaveEvent = `leave-${roomType}`
    const roomOf = (workspaceId: string) => `${roomType}:${workspaceId}`

    const setup = (socket: ReturnType<typeof createSocket>['socket'], roomManager: IRoomManager) =>
      setupWorkspaceInvalidationRoom(
        socket as unknown as Parameters<typeof setupWorkspaceInvalidationRoom>[0],
        roomManager,
        roomType
      )

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
      setup(socket, createRoomManager())

      await handlers[joinEvent]({ workspaceId: 'ws-1' })

      expect(socket.emit).toHaveBeenCalledWith(errorEvent, {
        workspaceId: 'ws-1',
        error: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
        retryable: false,
      })
    })

    it('rejects join with a retryable error when realtime is unavailable', async () => {
      const { socket, handlers } = createSocket()
      setup(socket, createRoomManager({ isReady: vi.fn().mockReturnValue(false) }))

      await handlers[joinEvent]({ workspaceId: 'ws-1' })

      expect(socket.emit).toHaveBeenCalledWith(
        errorEvent,
        expect.objectContaining({ code: 'ROOM_MANAGER_UNAVAILABLE', retryable: true })
      )
    })

    it('rejects join when workspace access is denied', async () => {
      mockAuthorizeRoom.mockResolvedValue({
        allowed: false,
        status: 403,
        workspaceId: 'ws-1',
        workspacePermission: null,
      })
      const { socket, handlers } = createSocket()
      setup(socket, createRoomManager())

      await handlers[joinEvent]({ workspaceId: 'ws-1' })

      expect(socket.emit).toHaveBeenCalledWith(
        errorEvent,
        expect.objectContaining({ code: 'ACCESS_DENIED', retryable: false })
      )
    })

    it('joins the room on success without any presence bookkeeping', async () => {
      const { socket, handlers } = createSocket()
      const roomManager = createRoomManager()
      setup(socket, roomManager)

      await handlers[joinEvent]({ workspaceId: 'ws-1' })

      expect(socket.join).toHaveBeenCalledWith(roomOf('ws-1'))
      expect(socket.emit).toHaveBeenCalledWith(successEvent, { workspaceId: 'ws-1' })
      // The room is live-list-only: no room-manager presence is tracked or broadcast.
      expect(roomManager.addUserToRoom).not.toHaveBeenCalled()
      expect(roomManager.broadcastPresenceUpdate).not.toHaveBeenCalled()
    })

    it('leaves a previously-joined room when switching workspaces', async () => {
      const { socket, handlers, rooms } = createSocket()
      rooms.add(roomOf('ws-old'))
      setup(socket, createRoomManager())

      await handlers[joinEvent]({ workspaceId: 'ws-1' })

      expect(socket.leave).toHaveBeenCalledWith(roomOf('ws-old'))
      expect(socket.join).toHaveBeenCalledWith(roomOf('ws-1'))
    })

    it('leaves the scoped room on leave', () => {
      const { socket, handlers, rooms } = createSocket()
      rooms.add(roomOf('ws-1'))
      setup(socket, createRoomManager())

      handlers[leaveEvent]({ workspaceId: 'ws-1' })

      expect(socket.leave).toHaveBeenCalledWith(roomOf('ws-1'))
    })

    it('cancels an in-flight join when the user leaves that workspace mid-authorize', async () => {
      const { socket, handlers } = createSocket()
      let resolveAuth: (value: unknown) => void = () => {}
      mockAuthorizeRoom.mockReturnValue(
        new Promise((resolve) => {
          resolveAuth = resolve
        })
      )
      setup(socket, createRoomManager())

      // Join ws-1 is awaiting authorization when the view unmounts and leaves ws-1.
      const joinPromise = handlers[joinEvent]({ workspaceId: 'ws-1' })
      handlers[leaveEvent]({ workspaceId: 'ws-1' })
      resolveAuth({ allowed: true, status: 200, workspaceId: 'ws-1', workspacePermission: 'admin' })
      await joinPromise

      // The stale join must NOT join the room the client has since left (no stranded membership).
      expect(socket.join).not.toHaveBeenCalled()
      expect(socket.emit).not.toHaveBeenCalledWith(successEvent, { workspaceId: 'ws-1' })
    })

    it('does not cancel an in-flight join when a deferred leave targets a different workspace', async () => {
      const { socket, handlers } = createSocket()
      let resolveAuth: (value: unknown) => void = () => {}
      mockAuthorizeRoom.mockReturnValue(
        new Promise((resolve) => {
          resolveAuth = resolve
        })
      )
      setup(socket, createRoomManager())

      // The client has switched to ws-2 (join in-flight) when a stale leave for the prior ws-1 lands.
      const joinPromise = handlers[joinEvent]({ workspaceId: 'ws-2' })
      handlers[leaveEvent]({ workspaceId: 'ws-1' })
      resolveAuth({ allowed: true, status: 200, workspaceId: 'ws-2', workspacePermission: 'admin' })
      await joinPromise

      // The deferred leave for ws-1 must not abort the join the client actually wants (ws-2).
      expect(socket.join).toHaveBeenCalledWith(roomOf('ws-2'))
      expect(socket.emit).toHaveBeenCalledWith(successEvent, { workspaceId: 'ws-2' })
    })
  }
)
