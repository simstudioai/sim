import { createLogger } from '@sim/logger'
import { createClient, type RedisClientType } from 'redis'
import type { Server } from 'socket.io'
import type { IRoomManager, UserPresence, UserSession } from '@/socket/rooms/types'

const logger = createLogger('RedisRoomManager')

const KEYS = {
  workflowUsers: (wfId: string) => `workflow:${wfId}:users`,
  workflowMeta: (wfId: string) => `workflow:${wfId}:meta`,
  socketWorkflow: (socketId: string) => `socket:${socketId}:workflow`,
  socketSession: (socketId: string) => `socket:${socketId}:session`,
  socketPresenceWorkflow: (socketId: string) => `socket:${socketId}:presence-workflow`,
} as const

const SOCKET_KEY_TTL = 3600
const SOCKET_PRESENCE_WORKFLOW_KEY_TTL = 24 * 60 * 60

/**
 * Lua script for atomic user removal from room.
 * Returns workflowId if user was removed, null otherwise.
 * Handles room cleanup atomically to prevent race conditions.
 */
const REMOVE_USER_SCRIPT = `
local socketWorkflowKey = KEYS[1]
local socketSessionKey = KEYS[2]
local socketPresenceWorkflowKey = KEYS[3]
local workflowUsersPrefix = ARGV[1]
local workflowMetaPrefix = ARGV[2]
local socketId = ARGV[3]
local workflowIdHint = ARGV[4]

local workflowId = redis.call('GET', socketWorkflowKey)
if not workflowId then
  workflowId = redis.call('GET', socketPresenceWorkflowKey)
end

if not workflowId and workflowIdHint ~= '' then
  workflowId = workflowIdHint
end

if not workflowId then
  return nil
end

local workflowUsersKey = workflowUsersPrefix .. workflowId .. ':users'
local workflowMetaKey = workflowMetaPrefix .. workflowId .. ':meta'

redis.call('HDEL', workflowUsersKey, socketId)
redis.call('DEL', socketWorkflowKey, socketSessionKey, socketPresenceWorkflowKey)

local remaining = redis.call('HLEN', workflowUsersKey)
if remaining == 0 then
  redis.call('DEL', workflowUsersKey, workflowMetaKey)
end

return workflowId
`

/**
 * Lua script for atomic user activity update.
 * Performs read-modify-write atomically to prevent lost updates.
 * Also refreshes TTL on socket keys to prevent expiry during long sessions.
 */
const UPDATE_ACTIVITY_SCRIPT = `
local workflowUsersKey = KEYS[1]
local socketWorkflowKey = KEYS[2]
local socketSessionKey = KEYS[3]
local socketPresenceWorkflowKey = KEYS[4]
local socketId = ARGV[1]
local cursorJson = ARGV[2]
local selectionJson = ARGV[3]
local lastActivity = ARGV[4]
local ttl = tonumber(ARGV[5])
local presenceWorkflowTtl = tonumber(ARGV[6])

local existingJson = redis.call('HGET', workflowUsersKey, socketId)
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

redis.call('HSET', workflowUsersKey, socketId, cjson.encode(existing))
redis.call('EXPIRE', socketWorkflowKey, ttl)
redis.call('EXPIRE', socketSessionKey, ttl)
redis.call('EXPIRE', socketPresenceWorkflowKey, presenceWorkflowTtl)
return 1
`

/**
 * Redis-backed room manager for multi-pod deployments.
 * Uses Lua scripts for atomic operations to prevent race conditions.
 */
export class RedisRoomManager implements IRoomManager {
  private redis: RedisClientType
  private _io: Server
  private isConnected = false
  private removeUserScriptSha: string | null = null
  private updateActivityScriptSha: string | null = null

  constructor(io: Server, redisUrl: string) {
    this._io = io
    this.redis = createClient({
      url: redisUrl,
    })

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

      // Pre-load Lua scripts for better performance
      this.removeUserScriptSha = await this.redis.scriptLoad(REMOVE_USER_SCRIPT)
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

  async addUserToRoom(workflowId: string, socketId: string, presence: UserPresence): Promise<void> {
    try {
      const pipeline = this.redis.multi()

      pipeline.hSet(KEYS.workflowUsers(workflowId), socketId, JSON.stringify(presence))
      pipeline.hSet(KEYS.workflowMeta(workflowId), 'lastModified', Date.now().toString())
      pipeline.set(KEYS.socketWorkflow(socketId), workflowId)
      pipeline.expire(KEYS.socketWorkflow(socketId), SOCKET_KEY_TTL)
      pipeline.set(KEYS.socketPresenceWorkflow(socketId), workflowId)
      pipeline.expire(KEYS.socketPresenceWorkflow(socketId), SOCKET_PRESENCE_WORKFLOW_KEY_TTL)
      pipeline.hSet(KEYS.socketSession(socketId), {
        userId: presence.userId,
        userName: presence.userName,
        avatarUrl: presence.avatarUrl || '',
      })
      pipeline.expire(KEYS.socketSession(socketId), SOCKET_KEY_TTL)

      const results = await pipeline.exec()

      // Check if any command failed
      const failed = results.some((result) => result instanceof Error)
      if (failed) {
        logger.error(`Pipeline partially failed when adding user to room`, { workflowId, socketId })
        throw new Error('Failed to store user session data in Redis')
      }

      logger.debug(`Added user ${presence.userId} to workflow ${workflowId} (socket: ${socketId})`)
    } catch (error) {
      logger.error(`Failed to add user to room: ${socketId} -> ${workflowId}`, error)
      throw error
    }
  }

  async removeUserFromRoom(
    socketId: string,
    workflowIdHint?: string,
    retried = false
  ): Promise<string | null> {
    if (!this.removeUserScriptSha) {
      logger.error('removeUserFromRoom called before initialize()')
      return null
    }

    try {
      const workflowId = await this.redis.evalSha(this.removeUserScriptSha, {
        keys: [
          KEYS.socketWorkflow(socketId),
          KEYS.socketSession(socketId),
          KEYS.socketPresenceWorkflow(socketId),
        ],
        arguments: ['workflow:', 'workflow:', socketId, workflowIdHint ?? ''],
      })

      if (typeof workflowId === 'string' && workflowId.length > 0) {
        logger.debug(`Removed socket ${socketId} from workflow ${workflowId}`)
        return workflowId
      }

      return null
    } catch (error) {
      if ((error as Error).message?.includes('NOSCRIPT') && !retried) {
        logger.warn('Lua script not found, reloading...')
        this.removeUserScriptSha = await this.redis.scriptLoad(REMOVE_USER_SCRIPT)
        return this.removeUserFromRoom(socketId, workflowIdHint, true)
      }
      logger.error(`Failed to remove user from room: ${socketId}`, error)
      return null
    }
  }

  async getWorkflowIdForSocket(socketId: string): Promise<string | null> {
    const workflowId = await this.redis.get(KEYS.socketWorkflow(socketId))
    if (workflowId) {
      return workflowId
    }

    return this.redis.get(KEYS.socketPresenceWorkflow(socketId))
  }

  async getUserSession(socketId: string): Promise<UserSession | null> {
    try {
      const session = await this.redis.hGetAll(KEYS.socketSession(socketId))

      if (!session.userId) {
        return null
      }

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

  async getWorkflowUsers(workflowId: string): Promise<UserPresence[]> {
    try {
      const users = await this.redis.hGetAll(KEYS.workflowUsers(workflowId))
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
      logger.error(`Failed to get workflow users for ${workflowId}:`, error)
      return []
    }
  }

  async hasWorkflowRoom(workflowId: string): Promise<boolean> {
    const exists = await this.redis.exists(KEYS.workflowUsers(workflowId))
    return exists > 0
  }

  async updateUserActivity(
    workflowId: string,
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
        keys: [
          KEYS.workflowUsers(workflowId),
          KEYS.socketWorkflow(socketId),
          KEYS.socketSession(socketId),
          KEYS.socketPresenceWorkflow(socketId),
        ],
        arguments: [
          socketId,
          updates.cursor !== undefined ? JSON.stringify(updates.cursor) : '',
          updates.selection !== undefined ? JSON.stringify(updates.selection) : '',
          (updates.lastActivity ?? Date.now()).toString(),
          SOCKET_KEY_TTL.toString(),
          SOCKET_PRESENCE_WORKFLOW_KEY_TTL.toString(),
        ],
      })
    } catch (error) {
      if ((error as Error).message?.includes('NOSCRIPT') && !retried) {
        logger.warn('Lua script not found, reloading...')
        this.updateActivityScriptSha = await this.redis.scriptLoad(UPDATE_ACTIVITY_SCRIPT)
        return this.updateUserActivity(workflowId, socketId, updates, true)
      }
      logger.error(`Failed to update user activity: ${socketId}`, error)
    }
  }

  async updateRoomLastModified(workflowId: string): Promise<void> {
    await this.redis.hSet(KEYS.workflowMeta(workflowId), 'lastModified', Date.now().toString())
  }

  async broadcastPresenceUpdate(workflowId: string): Promise<void> {
    const users = await this.getWorkflowUsers(workflowId)
    // io.to() with Redis adapter broadcasts to all pods
    this._io.to(workflowId).emit('presence-update', users)
  }

  emitToWorkflow<T = unknown>(workflowId: string, event: string, payload: T): void {
    this._io.to(workflowId).emit(event, payload)
  }

  async getUniqueUserCount(workflowId: string): Promise<number> {
    const users = await this.getWorkflowUsers(workflowId)
    const uniqueUserIds = new Set(users.map((u) => u.userId))
    return uniqueUserIds.size
  }

  async getTotalActiveConnections(): Promise<number> {
    // This is more complex with Redis - we'd need to scan all workflow:*:users keys
    // For now, just count sockets in this server instance
    // The true count would require aggregating across all pods
    return this._io.sockets.sockets.size
  }

  async handleWorkflowDeletion(workflowId: string): Promise<void> {
    logger.info(`Handling workflow deletion notification for ${workflowId}`)

    try {
      const users = await this.getWorkflowUsers(workflowId)
      if (users.length === 0) {
        logger.debug(`No active users found for deleted workflow ${workflowId}`)
        return
      }

      // Notify all clients across all pods via Redis adapter
      this._io.to(workflowId).emit('workflow-deleted', {
        workflowId,
        message: 'This workflow has been deleted',
        timestamp: Date.now(),
      })

      // Use Socket.IO's cross-pod socketsLeave() to remove all sockets from the room
      // This works across all pods when using the Redis adapter
      await this._io.in(workflowId).socketsLeave(workflowId)
      logger.debug(`All sockets left workflow room ${workflowId} via socketsLeave()`)

      // Remove all users from Redis state
      for (const user of users) {
        await this.removeUserFromRoom(user.socketId, workflowId)
      }

      // Clean up room data
      await this.redis.del([KEYS.workflowUsers(workflowId), KEYS.workflowMeta(workflowId)])

      logger.info(
        `Cleaned up workflow room ${workflowId} after deletion (${users.length} users disconnected)`
      )
    } catch (error) {
      logger.error(`Failed to handle workflow deletion for ${workflowId}:`, error)
    }
  }

  async handleWorkflowRevert(workflowId: string, timestamp: number): Promise<void> {
    logger.info(`Handling workflow revert notification for ${workflowId}`)

    const hasRoom = await this.hasWorkflowRoom(workflowId)
    if (!hasRoom) {
      logger.debug(`No active room found for reverted workflow ${workflowId}`)
      return
    }

    this._io.to(workflowId).emit('workflow-reverted', {
      workflowId,
      message: 'Workflow has been reverted to deployed state',
      timestamp,
    })

    await this.updateRoomLastModified(workflowId)

    const userCount = await this.getUniqueUserCount(workflowId)
    logger.info(`Notified ${userCount} users about workflow revert: ${workflowId}`)
  }

  async handleWorkflowUpdate(workflowId: string): Promise<void> {
    logger.info(`Handling workflow update notification for ${workflowId}`)

    const hasRoom = await this.hasWorkflowRoom(workflowId)
    if (!hasRoom) {
      logger.debug(`No active room found for updated workflow ${workflowId}`)
      return
    }

    const timestamp = Date.now()

    this._io.to(workflowId).emit('workflow-updated', {
      workflowId,
      message: 'Workflow has been updated externally',
      timestamp,
    })

    await this.updateRoomLastModified(workflowId)

    const userCount = await this.getUniqueUserCount(workflowId)
    logger.info(`Notified ${userCount} users about workflow update: ${workflowId}`)
  }
}
