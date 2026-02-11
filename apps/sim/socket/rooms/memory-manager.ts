import { createLogger } from '@sim/logger'
import type { Server } from 'socket.io'
import type { IRoomManager, UserPresence, UserSession, WorkflowRoom } from '@/socket/rooms/types'

const logger = createLogger('MemoryRoomManager')

/**
 * In-memory room manager for single-pod deployments
 * Used as fallback when REDIS_URL is not configured
 */
export class MemoryRoomManager implements IRoomManager {
  private workflowRooms = new Map<string, WorkflowRoom>()
  private socketToWorkflow = new Map<string, string>()
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
    this.workflowRooms.clear()
    this.socketToWorkflow.clear()
    this.userSessions.clear()
    logger.info('MemoryRoomManager shutdown complete')
  }

  async addUserToRoom(workflowId: string, socketId: string, presence: UserPresence): Promise<void> {
    // Create room if it doesn't exist
    if (!this.workflowRooms.has(workflowId)) {
      this.workflowRooms.set(workflowId, {
        workflowId,
        users: new Map(),
        lastModified: Date.now(),
        activeConnections: 0,
      })
    }

    const room = this.workflowRooms.get(workflowId)!
    room.users.set(socketId, presence)
    room.activeConnections++
    room.lastModified = Date.now()

    // Map socket to workflow
    this.socketToWorkflow.set(socketId, workflowId)

    // Store session
    this.userSessions.set(socketId, {
      userId: presence.userId,
      userName: presence.userName,
      avatarUrl: presence.avatarUrl,
    })

    logger.debug(`Added user ${presence.userId} to workflow ${workflowId} (socket: ${socketId})`)
  }

  async removeUserFromRoom(socketId: string, _workflowIdHint?: string): Promise<string | null> {
    const workflowId = this.socketToWorkflow.get(socketId)

    if (!workflowId) {
      return null
    }

    const room = this.workflowRooms.get(workflowId)
    if (room) {
      room.users.delete(socketId)
      room.activeConnections = Math.max(0, room.activeConnections - 1)

      // Clean up empty rooms
      if (room.activeConnections === 0) {
        this.workflowRooms.delete(workflowId)
        logger.info(`Cleaned up empty workflow room: ${workflowId}`)
      }
    }

    this.socketToWorkflow.delete(socketId)
    this.userSessions.delete(socketId)

    logger.debug(`Removed socket ${socketId} from workflow ${workflowId}`)
    return workflowId
  }

  async getWorkflowIdForSocket(socketId: string): Promise<string | null> {
    return this.socketToWorkflow.get(socketId) ?? null
  }

  async getUserSession(socketId: string): Promise<UserSession | null> {
    return this.userSessions.get(socketId) ?? null
  }

  async getWorkflowUsers(workflowId: string): Promise<UserPresence[]> {
    const room = this.workflowRooms.get(workflowId)
    if (!room) return []
    return Array.from(room.users.values())
  }

  async hasWorkflowRoom(workflowId: string): Promise<boolean> {
    return this.workflowRooms.has(workflowId)
  }

  async updateUserActivity(
    workflowId: string,
    socketId: string,
    updates: Partial<Pick<UserPresence, 'cursor' | 'selection' | 'lastActivity'>>
  ): Promise<void> {
    const room = this.workflowRooms.get(workflowId)
    if (!room) return

    const presence = room.users.get(socketId)
    if (presence) {
      if (updates.cursor !== undefined) presence.cursor = updates.cursor
      if (updates.selection !== undefined) presence.selection = updates.selection
      presence.lastActivity = updates.lastActivity ?? Date.now()
    }
  }

  async updateRoomLastModified(workflowId: string): Promise<void> {
    const room = this.workflowRooms.get(workflowId)
    if (room) {
      room.lastModified = Date.now()
    }
  }

  async broadcastPresenceUpdate(workflowId: string): Promise<void> {
    const users = await this.getWorkflowUsers(workflowId)
    this._io.to(workflowId).emit('presence-update', users)
  }

  emitToWorkflow<T = unknown>(workflowId: string, event: string, payload: T): void {
    this._io.to(workflowId).emit(event, payload)
  }

  async getUniqueUserCount(workflowId: string): Promise<number> {
    const room = this.workflowRooms.get(workflowId)
    if (!room) return 0

    const uniqueUsers = new Set<string>()
    room.users.forEach((presence) => {
      uniqueUsers.add(presence.userId)
    })

    return uniqueUsers.size
  }

  async getTotalActiveConnections(): Promise<number> {
    let total = 0
    for (const room of this.workflowRooms.values()) {
      total += room.activeConnections
    }
    return total
  }

  async handleWorkflowDeletion(workflowId: string): Promise<void> {
    logger.info(`Handling workflow deletion notification for ${workflowId}`)

    const room = this.workflowRooms.get(workflowId)
    if (!room) {
      logger.debug(`No active room found for deleted workflow ${workflowId}`)
      return
    }

    this._io.to(workflowId).emit('workflow-deleted', {
      workflowId,
      message: 'This workflow has been deleted',
      timestamp: Date.now(),
    })

    const socketsToDisconnect: string[] = []
    room.users.forEach((_presence, socketId) => {
      socketsToDisconnect.push(socketId)
    })

    for (const socketId of socketsToDisconnect) {
      const socket = this._io.sockets.sockets.get(socketId)
      if (socket) {
        socket.leave(workflowId)
        logger.debug(`Disconnected socket ${socketId} from deleted workflow ${workflowId}`)
      }
      await this.removeUserFromRoom(socketId)
    }

    this.workflowRooms.delete(workflowId)
    logger.info(
      `Cleaned up workflow room ${workflowId} after deletion (${socketsToDisconnect.length} users disconnected)`
    )
  }

  async handleWorkflowRevert(workflowId: string, timestamp: number): Promise<void> {
    logger.info(`Handling workflow revert notification for ${workflowId}`)

    const room = this.workflowRooms.get(workflowId)
    if (!room) {
      logger.debug(`No active room found for reverted workflow ${workflowId}`)
      return
    }

    this._io.to(workflowId).emit('workflow-reverted', {
      workflowId,
      message: 'Workflow has been reverted to deployed state',
      timestamp,
    })

    room.lastModified = timestamp

    logger.info(`Notified ${room.users.size} users about workflow revert: ${workflowId}`)
  }

  async handleWorkflowUpdate(workflowId: string): Promise<void> {
    logger.info(`Handling workflow update notification for ${workflowId}`)

    const room = this.workflowRooms.get(workflowId)
    if (!room) {
      logger.debug(`No active room found for updated workflow ${workflowId}`)
      return
    }

    const timestamp = Date.now()

    this._io.to(workflowId).emit('workflow-updated', {
      workflowId,
      message: 'Workflow has been updated externally',
      timestamp,
    })

    room.lastModified = timestamp

    logger.info(`Notified ${room.users.size} users about workflow update: ${workflowId}`)
  }
}
