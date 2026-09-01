/**
 * @vitest-environment node
 */
import { WORKSPACE_LIST_ROOM_TYPES } from '@sim/realtime-protocol/rooms'
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

import { setupWorkspaceInvalidationRoom } from '@/handlers/workspace-invalidation-room'
import { beginRoomPermissionRead, commitRoomPermission } from '@/middleware/permissions'

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

// The presence-free live-list rooms share one implementation; run the whole suite against each
// so they can never drift. Event names and room names derive from the room type.
describe.each(WORKSPACE_LIST_ROOM_TYPES)('setupWorkspaceInvalidationRoom(%s)', (roomType) => {
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

  it('aborts a join superseded during the access re-check await', async () => {
    // The access re-resolve is an await like any other: a leave landing during it must
    // still cancel this join, or the stale join would leave the room the client
    // switched to and commit the abandoned one. Forced down the re-resolve's DB path
    // by expiring the cached decision mid-join, so the interleaving is deterministic
    // rather than dependent on microtask ordering.
    vi.useFakeTimers()
    try {
      const { handlers, socket } = createSocket({ id: 'socket-sup', userId: 'user-sup' })
      setupWorkspaceInvalidationRoom(
        socket as unknown as Parameters<typeof setupWorkspaceInvalidationRoom>[0],
        createRoomManager(),
        roomType
      )

      let call = 0
      mockAuthorizeRoom.mockImplementation(async () => {
        call += 1
        if (call === 1) {
          // A later-started read commits, so this join's own decision is dropped; then
          // the join stalls past the TTL so that decision is expired by re-check time.
          commitRoomPermission(
            'user-sup',
            { type: roomType, id: 'ws-sup' },
            'admin',
            beginRoomPermissionRead()
          )
          await sleep(31_000)
        } else {
          // Second call is the re-check's re-resolve: the client leaves during it.
          handlers[leaveEvent]({ workspaceId: 'ws-sup' })
        }
        return { allowed: true, status: 200, workspaceId: 'ws-sup', workspacePermission: 'admin' }
      })

      const joining = handlers[joinEvent]({ workspaceId: 'ws-sup' })
      await vi.advanceTimersByTimeAsync(31_000)
      await joining

      expect(call).toBe(2)
      expect(socket.join).not.toHaveBeenCalled()
      expect(socket.emit).not.toHaveBeenCalledWith(successEvent, expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not join when access was revoked while the join was in flight', async () => {
    // The sweep records a revocation before it evicts, so a join whose authorize
    // completed just before that must not put the socket back in the room.
    const { handlers, socket } = createSocket({ id: 'socket-race', userId: 'user-race' })
    setupWorkspaceInvalidationRoom(
      socket as unknown as Parameters<typeof setupWorkspaceInvalidationRoom>[0],
      createRoomManager(),
      roomType
    )

    mockAuthorizeRoom.mockImplementation(async () => {
      commitRoomPermission(
        'user-race',
        { type: roomType, id: 'ws-race' },
        null,
        beginRoomPermissionRead()
      )
      return { allowed: true, status: 200, workspaceId: 'ws-race', workspacePermission: 'admin' }
    })

    await handlers[joinEvent]({ workspaceId: 'ws-race' })

    expect(socket.emit).toHaveBeenCalledWith(
      errorEvent,
      expect.objectContaining({ code: 'ACCESS_DENIED', retryable: false })
    )
    expect(socket.join).not.toHaveBeenCalled()
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
})
