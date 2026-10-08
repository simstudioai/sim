import { INVALIDATION_ROOM_TYPES, invalidationRoomIdKey } from '@sim/realtime-protocol/rooms'
import { createDeferred } from '@sim/testing'
import { databaseMock } from '@sim/testing/mocks/database.mock'
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IRoomManager } from '@/rooms'

const { mockAuthorizeRoom } = vi.hoisted(() => ({
  mockAuthorizeRoom: vi.fn(),
}))

vi.mock('@sim/db', () => databaseMock)

vi.mock('@sim/platform-authz/rooms', () => ({
  authorizeRoom: mockAuthorizeRoom,
}))

vi.mock('@/handlers/file-list-app', () => ({
  fetchProjectRoomAccess: mockAuthorizeRoom,
}))

import { setupWorkspaceInvalidationRoom } from '@/handlers/workspace-invalidation-room'
import { beginRoomPermissionRead, commitRoomPermission } from '@/middleware/permissions'

type Payload = { workspaceId?: string; projectId?: string }

function createSocket(overrides?: Record<string, unknown>) {
  const handlers: Record<string, (payload?: Payload) => Promise<void> | void> = {}
  // Live Set so the handler's native `socket.rooms` membership tracking works in tests.
  const rooms = new Set<string>()
  const socket = {
    id: 'socket-1',
    disconnected: false,
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

/** All invalidation room types share authorization and cancellation behavior. */
describe.each(INVALIDATION_ROOM_TYPES)('setupWorkspaceInvalidationRoom(%s)', (roomType) => {
  const joinEvent = `join-${roomType}`
  const successEvent = `${joinEvent}-success`
  const errorEvent = `${joinEvent}-error`
  const leaveEvent = `leave-${roomType}`
  const idKey = invalidationRoomIdKey(roomType)

  const setup = (socket: ReturnType<typeof createSocket>['socket'], roomManager: IRoomManager) =>
    setupWorkspaceInvalidationRoom(
      socket as unknown as Parameters<typeof setupWorkspaceInvalidationRoom>[0],
      roomManager,
      roomType
    )

  beforeEach(() => {
    mockAuthorizeRoom.mockResolvedValue({
      allowed: true,
      status: 200,
      workspaceId: 'ws-1',
      workspacePermission: 'admin',
    })
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

    await handlers[joinEvent]({ [idKey]: 'ws-1' })

    expect(socket.emit).toHaveBeenCalledWith(
      errorEvent,
      expect.objectContaining({ code: 'ACCESS_DENIED', retryable: false })
    )
  })

  it('aborts a join superseded during the access re-check await', async () => {
    /** Expire the cache to exercise a leave while the permission re-check is pending. */
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
          handlers[leaveEvent]({ [idKey]: 'ws-sup' })
        }
        return { allowed: true, status: 200, workspaceId: 'ws-sup', workspacePermission: 'admin' }
      })

      const joining = handlers[joinEvent]({ [idKey]: 'ws-sup' })
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

    await handlers[joinEvent]({ [idKey]: 'ws-race' })

    expect(socket.emit).toHaveBeenCalledWith(
      errorEvent,
      expect.objectContaining({ code: 'ACCESS_DENIED', retryable: false })
    )
    expect(socket.join).not.toHaveBeenCalled()
  })
})

/** Exercise every owner address through the real authorization and membership handler. */
describe.each(INVALIDATION_ROOM_TYPES)('concurrent owner subscriptions (%s)', (roomType) => {
  const idKey = invalidationRoomIdKey(roomType)
  const payload = (id: string): Payload => ({ [idKey]: id })
  const joinEvent = `join-${roomType}`
  const leaveEvent = `leave-${roomType}`
  const successEvent = `${joinEvent}-success`
  const errorEvent = `${joinEvent}-error`
  const allowed = { allowed: true, status: 200, workspacePermission: 'admin' }

  function setup() {
    const state = createSocket({ disconnected: false })
    setupWorkspaceInvalidationRoom(
      state.socket as unknown as Parameters<typeof setupWorkspaceInvalidationRoom>[0],
      createRoomManager(),
      roomType
    )
    return state
  }

  function pendingAuthorization() {
    const pending = createDeferred<typeof allowed>()
    mockAuthorizeRoom.mockImplementationOnce(() => pending.promise)
    return pending
  }

  beforeEach(() => {
    mockAuthorizeRoom.mockReset().mockResolvedValue(allowed)
  })

  it('keeps both owners subscribed after sequential joins', async () => {
    const { handlers, rooms } = setup()
    await handlers[joinEvent](payload('owner-a'))
    await handlers[joinEvent](payload('owner-b'))
    expect(rooms).toEqual(new Set([`${roomType}:owner-a`, `${roomType}:owner-b`]))
  })

  it('allows independent joins to finish in reverse order', async () => {
    const { handlers, rooms } = setup()
    const first = pendingAuthorization()
    const joining = handlers[joinEvent](payload('owner-a'))
    await handlers[joinEvent](payload('owner-b'))
    first.resolve(allowed)
    await joining
    expect(rooms).toEqual(new Set([`${roomType}:owner-a`, `${roomType}:owner-b`]))
  })

  it('scoped leave cancels only its pending owner and retains other membership', async () => {
    const { handlers, rooms } = setup()
    await handlers[joinEvent](payload('owner-c'))
    const first = pendingAuthorization()
    const joiningA = handlers[joinEvent](payload('owner-a'))
    const second = pendingAuthorization()
    const joiningB = handlers[joinEvent](payload('owner-b'))
    handlers[leaveEvent](payload('owner-a'))
    second.resolve(allowed)
    first.resolve(allowed)
    await Promise.all([joiningA, joiningB])
    expect(rooms).toEqual(new Set([`${roomType}:owner-b`, `${roomType}:owner-c`]))
  })

  it('scoped leave removes only the specified joined owner', async () => {
    const { handlers, rooms } = setup()
    await handlers[joinEvent](payload('owner-a'))
    await handlers[joinEvent](payload('owner-b'))
    handlers[leaveEvent](payload('owner-b'))
    expect(rooms).toEqual(new Set([`${roomType}:owner-a`]))
  })

  it('leave all cancels every pending join and removes only this room type', async () => {
    const { handlers, rooms } = setup()
    rooms.add('other:owner')
    await handlers[joinEvent](payload('owner-c'))
    const first = pendingAuthorization()
    const joiningA = handlers[joinEvent](payload('owner-a'))
    const second = pendingAuthorization()
    const joiningB = handlers[joinEvent](payload('owner-b'))
    handlers[leaveEvent]()
    first.resolve(allowed)
    second.resolve(allowed)
    await Promise.all([joiningA, joiningB])
    expect(rooms).toEqual(new Set(['other:owner']))
  })

  it('does not revive an old attempt after leave and rejoin of the same owner', async () => {
    const { handlers, socket, rooms } = setup()
    const first = pendingAuthorization()
    const joining = handlers[joinEvent](payload('owner-a'))
    handlers[leaveEvent](payload('owner-a'))
    await handlers[joinEvent](payload('owner-a'))
    first.resolve(allowed)
    await joining
    expect(rooms).toEqual(new Set([`${roomType}:owner-a`]))
    expect(socket.emit.mock.calls.filter(([event]) => event === successEvent)).toHaveLength(1)
  })

  it('supersedes a duplicate pending join for the same owner only', async () => {
    const { handlers, socket, rooms } = setup()
    const first = pendingAuthorization()
    const joining = handlers[joinEvent](payload('owner-a'))
    await handlers[joinEvent](payload('owner-b'))
    await handlers[joinEvent](payload('owner-a'))
    first.resolve(allowed)
    await joining
    expect(rooms).toEqual(new Set([`${roomType}:owner-a`, `${roomType}:owner-b`]))
    expect(socket.emit.mock.calls.filter(([event]) => event === successEvent)).toHaveLength(2)
  })

  it('suppresses stale authorization errors after the owner has rejoined', async () => {
    const { handlers, socket, rooms } = setup()
    const first = pendingAuthorization()
    const joining = handlers[joinEvent](payload('owner-a'))
    handlers[leaveEvent](payload('owner-a'))
    await handlers[joinEvent](payload('owner-a'))
    first.reject(new Error('Delayed authorization failure'))
    await joining
    expect(rooms).toEqual(new Set([`${roomType}:owner-a`]))
    expect(socket.emit).not.toHaveBeenCalledWith(errorEvent, expect.anything())
  })

  it('does not clear a newer pending attempt when the old attempt finishes', async () => {
    const { handlers, socket, rooms } = setup()
    const first = pendingAuthorization()
    const joiningA = handlers[joinEvent](payload('owner-a'))
    const second = pendingAuthorization()
    const joiningAgain = handlers[joinEvent](payload('owner-a'))
    first.resolve(allowed)
    await joiningA
    expect(rooms.size).toBe(0)
    second.resolve(allowed)
    await joiningAgain
    expect(rooms).toEqual(new Set([`${roomType}:owner-a`]))
    expect(socket.emit.mock.calls.filter(([event]) => event === successEvent)).toHaveLength(1)
  })

  it('preserves another owner while rejecting a revoked pending join', async () => {
    const { handlers, socket, rooms } = setup()
    await handlers[joinEvent](payload('owner-b'))
    const first = pendingAuthorization()
    const joining = handlers[joinEvent](payload('owner-a'))
    commitRoomPermission(
      socket.userId,
      { type: roomType, id: 'owner-a' },
      null,
      beginRoomPermissionRead()
    )
    first.resolve(allowed)
    await joining
    expect(rooms).toEqual(new Set([`${roomType}:owner-b`]))
    expect(socket.emit).toHaveBeenCalledWith(
      errorEvent,
      expect.objectContaining({ [idKey]: 'owner-a', code: 'ACCESS_DENIED' })
    )
  })

  it('does not commit any pending joins after disconnect', async () => {
    const { handlers, socket, rooms } = setup()
    const first = pendingAuthorization()
    const joining = handlers[joinEvent](payload('owner-a'))
    socket.disconnected = true
    first.resolve(allowed)
    await joining
    expect(rooms.size).toBe(0)
    expect(socket.emit).not.toHaveBeenCalledWith(successEvent, expect.anything())
  })

  it('rejects malformed joins without cancelling a valid pending owner', async () => {
    const { handlers, rooms } = setup()
    const first = pendingAuthorization()
    const joining = handlers[joinEvent](payload('owner-a'))
    await handlers[joinEvent](payload(''))
    first.resolve(allowed)
    await joining
    expect(rooms).toEqual(new Set([`${roomType}:owner-a`]))
  })
})
