/**
 * Multi-room semantics for the room manager. Exercises the invariants the
 * single-room → multi-room migration must preserve: a socket in two rooms,
 * refcounted session cleanup, presence isolation, and full-disconnect cleanup.
 *
 * @vitest-environment node
 */
import { ROOM_TYPES, type RoomRef } from '@sim/realtime-protocol/rooms'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRoomManager } from '@/rooms/memory-manager'
import type { UserPresence } from '@/rooms/types'

function fakeIo() {
  const emit = vi.fn()
  return {
    emit,
    io: { to: vi.fn().mockReturnValue({ emit }) } as never,
  }
}

function presence(room: RoomRef, socketId: string, userId: string): UserPresence {
  return {
    userId,
    room,
    userName: `user-${userId}`,
    socketId,
    joinedAt: Date.now(),
    lastActivity: Date.now(),
    role: 'admin',
  }
}

const WORKFLOW: RoomRef = { type: ROOM_TYPES.WORKFLOW, id: 'wf-1' }
const FILES: RoomRef = { type: ROOM_TYPES.WORKSPACE_FILES, id: 'ws-1' }

describe('MemoryRoomManager multi-room', () => {
  let manager: MemoryRoomManager

  beforeEach(async () => {
    manager = new MemoryRoomManager(fakeIo().io)
    await manager.initialize()
  })

  it('tracks a single socket in two rooms of different types', async () => {
    await manager.addUserToRoom(WORKFLOW, 'socket-1', presence(WORKFLOW, 'socket-1', 'user-1'))
    await manager.addUserToRoom(FILES, 'socket-1', presence(FILES, 'socket-1', 'user-1'))

    const rooms = await manager.getRoomsForSocket('socket-1')
    expect(rooms).toHaveLength(2)
    expect(rooms).toContainEqual(WORKFLOW)
    expect(rooms).toContainEqual(FILES)

    expect(await manager.getRoomForSocket('socket-1', ROOM_TYPES.WORKFLOW)).toEqual(WORKFLOW)
    expect(await manager.getRoomForSocket('socket-1', ROOM_TYPES.WORKSPACE_FILES)).toEqual(FILES)
  })

  it('keeps the shared session alive when leaving one of two rooms (refcount)', async () => {
    await manager.addUserToRoom(WORKFLOW, 'socket-1', presence(WORKFLOW, 'socket-1', 'user-1'))
    await manager.addUserToRoom(FILES, 'socket-1', presence(FILES, 'socket-1', 'user-1'))

    const removed = await manager.removeUserFromRoom(WORKFLOW, 'socket-1')
    expect(removed).toBe(true)

    // The files room and the shared session must survive.
    expect(await manager.hasRoom(WORKFLOW)).toBe(false)
    expect(await manager.hasRoom(FILES)).toBe(true)
    expect(await manager.getUserSession('socket-1')).not.toBeNull()
    expect(await manager.getRoomForSocket('socket-1', ROOM_TYPES.WORKFLOW)).toBeNull()
    expect(await manager.getRoomForSocket('socket-1', ROOM_TYPES.WORKSPACE_FILES)).toEqual(FILES)
  })

  it('drops the shared session only when the last room is left', async () => {
    await manager.addUserToRoom(WORKFLOW, 'socket-1', presence(WORKFLOW, 'socket-1', 'user-1'))
    await manager.addUserToRoom(FILES, 'socket-1', presence(FILES, 'socket-1', 'user-1'))

    await manager.removeUserFromRoom(WORKFLOW, 'socket-1')
    expect(await manager.getUserSession('socket-1')).not.toBeNull()

    await manager.removeUserFromRoom(FILES, 'socket-1')
    expect(await manager.getUserSession('socket-1')).toBeNull()
    expect(await manager.getRoomsForSocket('socket-1')).toHaveLength(0)
  })

  it('isolates presence between rooms of different types', async () => {
    await manager.addUserToRoom(WORKFLOW, 'socket-1', presence(WORKFLOW, 'socket-1', 'user-1'))
    await manager.addUserToRoom(FILES, 'socket-1', presence(FILES, 'socket-1', 'user-1'))
    await manager.addUserToRoom(FILES, 'socket-2', presence(FILES, 'socket-2', 'user-2'))

    expect(await manager.getRoomUsers(WORKFLOW)).toHaveLength(1)
    expect(await manager.getRoomUsers(FILES)).toHaveLength(2)
  })

  it('removes a socket from every room on disconnect and reports them', async () => {
    await manager.addUserToRoom(WORKFLOW, 'socket-1', presence(WORKFLOW, 'socket-1', 'user-1'))
    await manager.addUserToRoom(FILES, 'socket-1', presence(FILES, 'socket-1', 'user-1'))
    await manager.addUserToRoom(FILES, 'socket-2', presence(FILES, 'socket-2', 'user-2'))

    const removed = await manager.removeSocketFromAllRooms('socket-1')
    expect(removed).toHaveLength(2)
    expect(removed).toContainEqual(WORKFLOW)
    expect(removed).toContainEqual(FILES)

    expect(await manager.hasRoom(WORKFLOW)).toBe(false)
    // The files room still has socket-2.
    expect(await manager.getRoomUsers(FILES)).toHaveLength(1)
    expect(await manager.getUserSession('socket-1')).toBeNull()
  })

  it('does not clobber another type when two sockets share a room', async () => {
    await manager.addUserToRoom(FILES, 'socket-1', presence(FILES, 'socket-1', 'user-1'))
    await manager.addUserToRoom(FILES, 'socket-2', presence(FILES, 'socket-2', 'user-2'))

    await manager.removeUserFromRoom(FILES, 'socket-1')
    expect(await manager.hasRoom(FILES)).toBe(true)
    expect(await manager.getUserSession('socket-2')).not.toBeNull()
  })

  it('ignores removal of a room the socket is not in (id-guarded)', async () => {
    await manager.addUserToRoom(FILES, 'socket-1', presence(FILES, 'socket-1', 'user-1'))

    // Removing a workflow room the socket never joined must be a no-op — it must
    // not wipe the files mapping or the shared session.
    const removed = await manager.removeUserFromRoom(WORKFLOW, 'socket-1')
    expect(removed).toBe(false)
    expect(await manager.hasRoom(FILES)).toBe(true)
    expect(await manager.getUserSession('socket-1')).not.toBeNull()
    expect(await manager.getRoomForSocket('socket-1', ROOM_TYPES.WORKSPACE_FILES)).toEqual(FILES)
  })

  it('broadcasts presence on the room-type-specific event name', async () => {
    const { emit, io } = fakeIo()
    const m = new MemoryRoomManager(io)
    await m.initialize()
    await m.addUserToRoom(FILES, 'socket-1', presence(FILES, 'socket-1', 'user-1'))

    await m.broadcastPresenceUpdate(FILES)
    expect(emit).toHaveBeenCalledWith('workspace-files:presence-update', expect.any(Array))

    await m.broadcastPresenceUpdate(WORKFLOW)
    expect(emit).toHaveBeenCalledWith('presence-update', expect.any(Array))
  })

  it('omits an excluded socket from the presence broadcast (disconnect ghost guard)', async () => {
    const { emit, io } = fakeIo()
    const m = new MemoryRoomManager(io)
    await m.initialize()
    await m.addUserToRoom(FILES, 'socket-1', presence(FILES, 'socket-1', 'user-1'))
    await m.addUserToRoom(FILES, 'socket-2', presence(FILES, 'socket-2', 'user-2'))

    // Broadcast as if socket-1 is disconnecting: even though its presence entry is
    // still present, it must not appear in the emitted list.
    await m.broadcastPresenceUpdate(FILES, 'socket-1')
    const emitted = emit.mock.calls.at(-1)?.[1] as Array<{ socketId: string }>
    expect(emitted.map((u) => u.socketId)).toEqual(['socket-2'])
  })
})
