import { createLogger } from '@sim/logger'
import {
  presenceEventName,
  type RoomRef,
  type RoomType,
  roomName,
} from '@sim/realtime-protocol/rooms'
import { createClient, type RedisClientType } from 'redis'
import type { Server } from 'socket.io'
import { filterVisiblePresence } from '@/rooms/presence-visibility'
import type { IRoomManager, UserPresence, UserSession } from '@/rooms/types'

const logger = createLogger('RedisRoomManager')

/**
 * Redis key scheme (all room-scoped keys are prefixed by room type):
 *   {type}:{id}:users        HASH  socketId -> UserPresence JSON  (room membership)
 *   {type}:{id}:meta         HASH  room metadata (lastModified)
 *   socket:{sid}:rooms       HASH  roomType -> roomId  (the socket's rooms, one per type)
 *   socket:{sid}:session     HASH  userId/userName/avatarUrl  (shared across the socket's rooms)
 *
 * Workflow rooms keep their historical `workflow:{id}:users`/`:meta` keys (the
 * type prefix IS `workflow`), so no presence-state migration is needed for them.
 */
const KEYS = {
  roomUsers: (room: RoomRef) => `${room.type}:${room.id}:users`,
  roomMeta: (room: RoomRef) => `${room.type}:${room.id}:meta`,
  socketRooms: (socketId: string) => `socket:${socketId}:rooms`,
  socketSession: (socketId: string) => `socket:${socketId}:session`,
} as const

/** TTL for the socket's room-set. Long enough that an idle-but-connected socket is not evicted. */
const SOCKET_ROOMS_TTL = 24 * 60 * 60
/** TTL for the shared session key; refreshed on every activity update. */
const SESSION_TTL = 60 * 60

/**
 * Atomic single-room removal. Removes a socket from one room's presence, drops
 * the room from the socket's room-set, and — critically — deletes the SHARED
 * session key only when the socket has left its LAST room (otherwise a leave from
 * one room would break the socket's other rooms). Cleans up empty room state.
 *
 * KEYS: [socketRooms, socketSession, roomUsers, roomMeta]
 * ARGV: [roomType, socketId, roomId]
 * Returns 1 if the socket was a member of the room, else 0.
 */
const REMOVE_ROOM_SCRIPT = `
local socketRoomsKey = KEYS[1]
local socketSessionKey = KEYS[2]
local roomUsersKey = KEYS[3]
local roomMetaKey = KEYS[4]
local roomType = ARGV[1]
local socketId = ARGV[2]
local roomId = ARGV[3]

local removed = redis.call('HDEL', roomUsersKey, socketId)

-- Only drop the socket's mapping for this type if it points at THIS room, so
-- removing a room the socket isn't in can't wipe a different room's mapping or
-- spuriously trigger the last-room session cleanup (mirrors the memory manager).
if redis.call('HGET', socketRoomsKey, roomType) == roomId then
  redis.call('HDEL', socketRoomsKey, roomType)
  if redis.call('HLEN', socketRoomsKey) == 0 then
    redis.call('DEL', socketRoomsKey, socketSessionKey)
  end
end

if redis.call('HLEN', roomUsersKey) == 0 then
  redis.call('DEL', roomUsersKey, roomMetaKey)
end

return removed
`

/**
 * Atomic presence-activity update (read-modify-write) that also refreshes the
 * socket key TTLs to keep a long-lived session alive.
 *
 * KEYS: [roomUsers, socketRooms, socketSession]
 * ARGV: [socketId, cursorJson, selectionJson, lastActivity, roomsTtl, sessionTtl]
 * Returns 1 if the socket had presence in the room, else 0.
 */
const UPDATE_ACTIVITY_SCRIPT = `
local roomUsersKey = KEYS[1]
local socketRoomsKey = KEYS[2]
local socketSessionKey = KEYS[3]
local socketId = ARGV[1]
local cursorJson = ARGV[2]
local selectionJson = ARGV[3]
local lastActivity = ARGV[4]
local roomsTtl = tonumber(ARGV[5])
local sessionTtl = tonumber(ARGV[6])

local existingJson = redis.call('HGET', roomUsersKey, socketId)
if not existingJson then
  return 0
end

local existing = cjson.decode(existingJson)
if cursorJson ~= '' then
  existing.cursor = cjson.decode(cursorJson)
end
if selectionJson ~= '' then
  existing.selection = cjson.decode(selectionJson)
end
existing.lastActivity = tonumber(lastActivity)

redis.call('HSET', roomUsersKey, socketId, cjson.encode(existing))
redis.call('EXPIRE', socketRoomsKey, roomsTtl)
redis.call('EXPIRE', socketSessionKey, sessionTtl)
return 1
`

/**
 * Redis-backed room manager for multi-pod deployments. Domain-neutral: keyed by
 * {@link RoomRef}, supports a socket in multiple rooms (one per {@link RoomType}).
 * Uses Lua scripts for atomic multi-key operations.
 */
export class RedisRoomManager implements IRoomManager {
  private redis: RedisClientType
  private _io: Server
  private isConnected = false
  private removeRoomScriptSha: string | null = null
  private updateActivityScriptSha: string | null = null

  constructor(io: Server, redisUrl: string) {
    this._io = io
    this.redis = createClient({ url: redisUrl })

    this.redis.on('error', (err) => {
      logger.error('Redis client error:', err)
    })
    this.redis.on('reconnecting', () => {
      logger.warn('Redis client reconnecting...')
      this.isConnected = false
    })
    this.redis.on('ready', () => {
      logger.info('Redis client ready')
      this.isConnected = true
    })
    this.redis.on('end', () => {
      logger.warn('Redis client connection closed')
      this.isConnected = false
    })
  }

  get io(): Server {
    return this._io
  }

  isReady(): boolean {
    return this.isConnected
  }

  async initialize(): Promise<void> {
    if (this.isConnected) return

    try {
      await this.redis.connect()
      this.isConnected = true

      this.removeRoomScriptSha = await this.redis.scriptLoad(REMOVE_ROOM_SCRIPT)
      this.updateActivityScriptSha = await this.redis.scriptLoad(UPDATE_ACTIVITY_SCRIPT)

      logger.info('RedisRoomManager connected to Redis and scripts loaded')
    } catch (error) {
      logger.error('Failed to connect to Redis:', error)
      throw error
    }
  }

  async shutdown(): Promise<void> {
    if (!this.isConnected) return
    try {
      await this.redis.quit()
      this.isConnected = false
      logger.info('RedisRoomManager disconnected from Redis')
    } catch (error) {
      logger.error('Error during Redis shutdown:', error)
    }
  }

  async addUserToRoom(room: RoomRef, socketId: string, presence: UserPresence): Promise<void> {
    try {
      const pipeline = this.redis.multi()

      pipeline.hSet(KEYS.roomUsers(room), socketId, JSON.stringify(presence))
      pipeline.hSet(KEYS.roomMeta(room), 'lastModified', Date.now().toString())
      pipeline.hSet(KEYS.socketRooms(socketId), room.type, room.id)
      pipeline.expire(KEYS.socketRooms(socketId), SOCKET_ROOMS_TTL)
      pipeline.hSet(KEYS.socketSession(socketId), {
        userId: presence.userId,
        userName: presence.userName,
        avatarUrl: presence.avatarUrl || '',
      })
      pipeline.expire(KEYS.socketSession(socketId), SESSION_TTL)

      const results = await pipeline.exec()

      const failed = results.some((result) => result instanceof Error)
      if (failed) {
        logger.error('Pipeline partially failed when adding user to room', {
          room,
          socketId,
        })
        throw new Error('Failed to store user session data in Redis')
      }

      logger.debug(`Added user ${presence.userId} to room ${room.type}:${room.id} (${socketId})`)
    } catch (error) {
      logger.error(`Failed to add user to room: ${socketId} -> ${room.type}:${room.id}`, error)
      throw error
    }
  }

  async removeUserFromRoom(room: RoomRef, socketId: string, retried = false): Promise<boolean> {
    if (!this.removeRoomScriptSha) {
      logger.error('removeUserFromRoom called before initialize()')
      return false
    }

    try {
      const removed = await this.redis.evalSha(this.removeRoomScriptSha, {
        keys: [
          KEYS.socketRooms(socketId),
          KEYS.socketSession(socketId),
          KEYS.roomUsers(room),
          KEYS.roomMeta(room),
        ],
        arguments: [room.type, socketId, room.id],
      })
      return typeof removed === 'number' ? removed > 0 : Number(removed) > 0
    } catch (error) {
      if ((error as Error).message?.includes('NOSCRIPT') && !retried) {
        logger.warn('Lua script not found, reloading...')
        this.removeRoomScriptSha = await this.redis.scriptLoad(REMOVE_ROOM_SCRIPT)
        return this.removeUserFromRoom(room, socketId, true)
      }
      logger.error(`Failed to remove socket ${socketId} from room ${room.type}:${room.id}`, error)
      return false
    }
  }

  async removeSocketFromAllRooms(socketId: string): Promise<RoomRef[]> {
    const rooms = await this.getRoomsForSocket(socketId)
    if (rooms.length === 0) {
      // Nothing tracked (already cleaned up or TTL-expired); ensure session is gone.
      await this.redis.del(KEYS.socketSession(socketId)).catch(() => {})
      return []
    }

    const removed: RoomRef[] = []
    for (const room of rooms) {
      const wasMember = await this.removeUserFromRoom(room, socketId)
      if (wasMember) removed.push(room)
    }
    return removed
  }

  async getRoomsForSocket(socketId: string): Promise<RoomRef[]> {
    try {
      const entries = await this.redis.hGetAll(KEYS.socketRooms(socketId))
      return Object.entries(entries).map(([type, id]) => ({ type: type as RoomType, id }))
    } catch (error) {
      logger.error(`Failed to get rooms for socket ${socketId}:`, error)
      return []
    }
  }

  async getRoomForSocket(socketId: string, type: RoomType): Promise<RoomRef | null> {
    const id = await this.redis.hGet(KEYS.socketRooms(socketId), type)
    return id ? { type, id } : null
  }

  async getUserSession(socketId: string): Promise<UserSession | null> {
    try {
      const session = await this.redis.hGetAll(KEYS.socketSession(socketId))
      if (!session.userId) return null
      return {
        userId: session.userId,
        userName: session.userName,
        avatarUrl: session.avatarUrl || undefined,
      }
    } catch (error) {
      logger.error(`Failed to get user session for ${socketId}:`, error)
      return null
    }
  }

  async getRoomUsers(room: RoomRef): Promise<UserPresence[]> {
    try {
      const users = await this.redis.hGetAll(KEYS.roomUsers(room))
      return Object.entries(users)
        .map(([socketId, json]) => {
          try {
            return JSON.parse(json) as UserPresence
          } catch {
            logger.warn(`Corrupted user data for socket ${socketId}, skipping`)
            return null
          }
        })
        .filter((u): u is UserPresence => u !== null)
    } catch (error) {
      logger.error(`Failed to get room users for ${room.type}:${room.id}:`, error)
      return []
    }
  }

  async hasRoom(room: RoomRef): Promise<boolean> {
    const exists = await this.redis.exists(KEYS.roomUsers(room))
    return exists > 0
  }

  async deleteRoom(room: RoomRef): Promise<void> {
    try {
      await this.redis.del([KEYS.roomUsers(room), KEYS.roomMeta(room)])
    } catch (error) {
      logger.error(`Failed to delete room ${room.type}:${room.id}:`, error)
    }
  }

  async updateUserActivity(
    room: RoomRef,
    socketId: string,
    updates: Partial<Pick<UserPresence, 'cursor' | 'selection' | 'lastActivity'>>,
    retried = false
  ): Promise<void> {
    if (!this.updateActivityScriptSha) {
      logger.error('updateUserActivity called before initialize()')
      return
    }

    try {
      await this.redis.evalSha(this.updateActivityScriptSha, {
        keys: [KEYS.roomUsers(room), KEYS.socketRooms(socketId), KEYS.socketSession(socketId)],
        arguments: [
          socketId,
          updates.cursor !== undefined ? JSON.stringify(updates.cursor) : '',
          updates.selection !== undefined ? JSON.stringify(updates.selection) : '',
          (updates.lastActivity ?? Date.now()).toString(),
          SOCKET_ROOMS_TTL.toString(),
          SESSION_TTL.toString(),
        ],
      })
    } catch (error) {
      if ((error as Error).message?.includes('NOSCRIPT') && !retried) {
        logger.warn('Lua script not found, reloading...')
        this.updateActivityScriptSha = await this.redis.scriptLoad(UPDATE_ACTIVITY_SCRIPT)
        return this.updateUserActivity(room, socketId, updates, true)
      }
      logger.error(`Failed to update user activity: ${socketId}`, error)
    }
  }

  async updateRoomLastModified(room: RoomRef): Promise<void> {
    await this.redis.hSet(KEYS.roomMeta(room), 'lastModified', Date.now().toString())
  }

  async broadcastPresenceUpdate(room: RoomRef, excludeSocketId?: string): Promise<void> {
    const users = await this.getRoomUsers(room)
    const visible = await filterVisiblePresence(this._io, room, users, excludeSocketId)
    // io.to() with the Redis adapter broadcasts to all pods.
    this._io.to(roomName(room)).emit(presenceEventName(room.type), visible)
  }

  emitToRoom<T = unknown>(room: RoomRef, event: string, payload: T): void {
    this._io.to(roomName(room)).emit(event, payload)
  }

  async getUniqueUserCount(room: RoomRef): Promise<number> {
    const users = await this.getRoomUsers(room)
    return new Set(users.map((u) => u.userId)).size
  }

  async getTotalActiveConnections(): Promise<number> {
    // Local instance only; the true cross-pod count would require aggregation.
    return this._io.sockets.sockets.size
  }
}
