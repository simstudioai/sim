import { createLogger } from '@sim/logger'
import {
  presenceEventName,
  type RoomRef,
  type RoomType,
  roomName,
} from '@sim/realtime-protocol/rooms'
import type { Server } from 'socket.io'
import type { IRoomManager, RoomState, UserPresence, UserSession } from '@/rooms/types'

const logger = createLogger('MemoryRoomManager')

/** Stable string key for a room in the local maps (distinct from the Socket.IO room name). */
function roomKey(room: RoomRef): string {
  return `${room.type}:${room.id}`
}

/**
 * In-memory room manager for single-pod deployments. Used when REDIS_URL is not
 * configured. Domain-neutral: keyed by {@link RoomRef}, supports a socket in
 * multiple rooms (one per {@link RoomType}).
 */
export class MemoryRoomManager implements IRoomManager {
  private rooms = new Map<string, RoomState>()
  /** socketId -> (roomType -> roomId) */
  private socketRooms = new Map<string, Map<RoomType, string>>()
  private userSessions = new Map<string, UserSession>()
  private _io: Server

  constructor(io: Server) {
    this._io = io
  }

  get io(): Server {
    return this._io
  }

  async initialize(): Promise<void> {
    logger.info('MemoryRoomManager initialized (single-pod mode)')
  }

  isReady(): boolean {
    return true
  }

  async shutdown(): Promise<void> {
    this.rooms.clear()
    this.socketRooms.clear()
    this.userSessions.clear()
    logger.info('MemoryRoomManager shutdown complete')
  }

  async addUserToRoom(room: RoomRef, socketId: string, presence: UserPresence): Promise<void> {
    const key = roomKey(room)
    let state = this.rooms.get(key)
    if (!state) {
      state = { room, users: new Map(), lastModified: Date.now(), activeConnections: 0 }
      this.rooms.set(key, state)
    }

    state.users.set(socketId, presence)
    state.activeConnections++
    state.lastModified = Date.now()

    let socketRoomMap = this.socketRooms.get(socketId)
    if (!socketRoomMap) {
      socketRoomMap = new Map()
      this.socketRooms.set(socketId, socketRoomMap)
    }
    socketRoomMap.set(room.type, room.id)

    this.userSessions.set(socketId, {
      userId: presence.userId,
      userName: presence.userName,
      avatarUrl: presence.avatarUrl,
    })

    logger.debug(`Added user ${presence.userId} to room ${key} (socket: ${socketId})`)
  }

  async removeUserFromRoom(room: RoomRef, socketId: string): Promise<boolean> {
    const key = roomKey(room)
    const state = this.rooms.get(key)
    let existed = false

    if (state?.users.has(socketId)) {
      existed = true
      state.users.delete(socketId)
      state.activeConnections = Math.max(0, state.activeConnections - 1)
      if (state.users.size === 0) {
        this.rooms.delete(key)
        logger.info(`Cleaned up empty room: ${key}`)
      }
    }

    const socketRoomMap = this.socketRooms.get(socketId)
    if (socketRoomMap && socketRoomMap.get(room.type) === room.id) {
      socketRoomMap.delete(room.type)
      // Drop the shared session only when the socket has left its last room.
      if (socketRoomMap.size === 0) {
        this.socketRooms.delete(socketId)
        this.userSessions.delete(socketId)
      }
    }

    return existed
  }

  async removeSocketFromAllRooms(socketId: string): Promise<RoomRef[]> {
    const socketRoomMap = this.socketRooms.get(socketId)
    if (!socketRoomMap || socketRoomMap.size === 0) {
      this.userSessions.delete(socketId)
      return []
    }

    const rooms: RoomRef[] = Array.from(socketRoomMap.entries()).map(([type, id]) => ({ type, id }))
    for (const room of rooms) {
      await this.removeUserFromRoom(room, socketId)
    }
    // Belt-and-suspenders: ensure session is gone even if the map drifted.
    this.socketRooms.delete(socketId)
    this.userSessions.delete(socketId)
    return rooms
  }

  async getRoomsForSocket(socketId: string): Promise<RoomRef[]> {
    const socketRoomMap = this.socketRooms.get(socketId)
    if (!socketRoomMap) return []
    return Array.from(socketRoomMap.entries()).map(([type, id]) => ({ type, id }))
  }

  async getRoomForSocket(socketId: string, type: RoomType): Promise<RoomRef | null> {
    const id = this.socketRooms.get(socketId)?.get(type)
    return id ? { type, id } : null
  }

  async getUserSession(socketId: string): Promise<UserSession | null> {
    return this.userSessions.get(socketId) ?? null
  }

  async getRoomUsers(room: RoomRef): Promise<UserPresence[]> {
    const state = this.rooms.get(roomKey(room))
    if (!state) return []
    return Array.from(state.users.values())
  }

  async hasRoom(room: RoomRef): Promise<boolean> {
    return this.rooms.has(roomKey(room))
  }

  async updateUserActivity(
    room: RoomRef,
    socketId: string,
    updates: Partial<Pick<UserPresence, 'cursor' | 'selection' | 'lastActivity'>>
  ): Promise<void> {
    const presence = this.rooms.get(roomKey(room))?.users.get(socketId)
    if (!presence) return

    if (updates.cursor !== undefined) presence.cursor = updates.cursor
    if (updates.selection !== undefined) presence.selection = updates.selection
    presence.lastActivity = updates.lastActivity ?? Date.now()
  }

  async updateRoomLastModified(room: RoomRef): Promise<void> {
    const state = this.rooms.get(roomKey(room))
    if (state) state.lastModified = Date.now()
  }

  async broadcastPresenceUpdate(room: RoomRef): Promise<void> {
    const users = await this.getRoomUsers(room)
    this._io.to(roomName(room)).emit(presenceEventName(room.type), users)
  }

  emitToRoom<T = unknown>(room: RoomRef, event: string, payload: T): void {
    this._io.to(roomName(room)).emit(event, payload)
  }

  async getUniqueUserCount(room: RoomRef): Promise<number> {
    const state = this.rooms.get(roomKey(room))
    if (!state) return 0
    const uniqueUsers = new Set<string>()
    state.users.forEach((presence) => uniqueUsers.add(presence.userId))
    return uniqueUsers.size
  }

  async getTotalActiveConnections(): Promise<number> {
    let total = 0
    for (const state of this.rooms.values()) {
      total += state.activeConnections
    }
    return total
  }
}
