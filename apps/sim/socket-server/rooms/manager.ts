import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { Server } from 'socket.io'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import * as schema from '@/db/schema'
import { workflowBlocks, workflowEdges } from '@/db/schema'

// Create dedicated database connection for room manager
const connectionString = env.POSTGRES_URL ?? env.DATABASE_URL
const db = drizzle(
  postgres(connectionString, {
    prepare: false,
    idle_timeout: 15,
    connect_timeout: 20,
    max: 5,
    onnotice: () => {},
  }),
  { schema }
)

const logger = createLogger('RoomManager')

export interface UserPresence {
  userId: string
  workflowId: string
  userName: string
  socketId: string
  joinedAt: number
  lastActivity: number
  cursor?: { x: number; y: number }
  selection?: { type: 'block' | 'edge' | 'none'; id?: string }
}

export interface WorkflowRoom {
  workflowId: string
  users: Map<string, UserPresence> // socketId -> UserPresence
  lastModified: number
  activeConnections: number
}

export class RoomManager {
  private workflowRooms = new Map<string, WorkflowRoom>()
  private socketToWorkflow = new Map<string, string>()
  private userSessions = new Map<string, { userId: string; userName: string }>()
  private io: Server

  constructor(io: Server) {
    this.io = io
  }

  createWorkflowRoom(workflowId: string): WorkflowRoom {
    return {
      workflowId,
      users: new Map(),
      lastModified: Date.now(),
      activeConnections: 0,
    }
  }

  cleanupUserFromRoom(socketId: string, workflowId: string) {
    const room = this.workflowRooms.get(workflowId)
    if (room) {
      room.users.delete(socketId)
      room.activeConnections = Math.max(0, room.activeConnections - 1)

      if (room.activeConnections === 0) {
        this.workflowRooms.delete(workflowId)
        logger.info(`Cleaned up empty workflow room: ${workflowId}`)
      }
    }

    this.socketToWorkflow.delete(socketId)
    this.userSessions.delete(socketId)
  }

  handleWorkflowDeletion(workflowId: string) {
    logger.info(`Handling workflow deletion notification for ${workflowId}`)

    const room = this.workflowRooms.get(workflowId)
    if (!room) {
      logger.debug(`No active room found for deleted workflow ${workflowId}`)
      return
    }

    this.io.to(workflowId).emit('workflow-deleted', {
      workflowId,
      message: 'This workflow has been deleted',
      timestamp: Date.now(),
    })

    const socketsToDisconnect: string[] = []
    room.users.forEach((_presence, socketId) => {
      socketsToDisconnect.push(socketId)
    })

    socketsToDisconnect.forEach((socketId) => {
      const socket = this.io.sockets.sockets.get(socketId)
      if (socket) {
        socket.leave(workflowId)
        logger.debug(`Disconnected socket ${socketId} from deleted workflow ${workflowId}`)
      }
      this.cleanupUserFromRoom(socketId, workflowId)
    })

    this.workflowRooms.delete(workflowId)
    logger.info(
      `Cleaned up workflow room ${workflowId} after deletion (${socketsToDisconnect.length} users disconnected)`
    )
  }

  handleWorkflowRevert(workflowId: string, timestamp: number) {
    logger.info(`Handling workflow revert notification for ${workflowId}`)

    const room = this.workflowRooms.get(workflowId)
    if (!room) {
      logger.debug(`No active room found for reverted workflow ${workflowId}`)
      return
    }

    this.io.to(workflowId).emit('workflow-reverted', {
      workflowId,
      message: 'Workflow has been reverted to deployed state',
      timestamp,
    })

    room.lastModified = timestamp

    logger.info(`Notified ${room.users.size} users about workflow revert: ${workflowId}`)
  }

  async validateWorkflowConsistency(
    workflowId: string
  ): Promise<{ valid: boolean; issues: string[] }> {
    try {
      const issues: string[] = []

      const orphanedEdges = await db
        .select({
          id: workflowEdges.id,
          sourceBlockId: workflowEdges.sourceBlockId,
          targetBlockId: workflowEdges.targetBlockId,
        })
        .from(workflowEdges)
        .leftJoin(workflowBlocks, eq(workflowEdges.sourceBlockId, workflowBlocks.id))
        .where(and(eq(workflowEdges.workflowId, workflowId), isNull(workflowBlocks.id)))

      if (orphanedEdges.length > 0) {
        issues.push(`Found ${orphanedEdges.length} orphaned edges with missing source blocks`)
      }

      return { valid: issues.length === 0, issues }
    } catch (error) {
      logger.error('Error validating workflow consistency:', error)
      return { valid: false, issues: ['Consistency check failed'] }
    }
  }

  getWorkflowRooms(): ReadonlyMap<string, WorkflowRoom> {
    return this.workflowRooms
  }

  getSocketToWorkflow(): ReadonlyMap<string, string> {
    return this.socketToWorkflow
  }

  getUserSessions(): ReadonlyMap<string, { userId: string; userName: string }> {
    return this.userSessions
  }

  hasWorkflowRoom(workflowId: string): boolean {
    return this.workflowRooms.has(workflowId)
  }

  getWorkflowRoom(workflowId: string): WorkflowRoom | undefined {
    return this.workflowRooms.get(workflowId)
  }

  setWorkflowRoom(workflowId: string, room: WorkflowRoom): void {
    this.workflowRooms.set(workflowId, room)
  }

  getWorkflowIdForSocket(socketId: string): string | undefined {
    return this.socketToWorkflow.get(socketId)
  }

  setWorkflowForSocket(socketId: string, workflowId: string): void {
    this.socketToWorkflow.set(socketId, workflowId)
  }

  getUserSession(socketId: string): { userId: string; userName: string } | undefined {
    return this.userSessions.get(socketId)
  }

  setUserSession(socketId: string, session: { userId: string; userName: string }): void {
    this.userSessions.set(socketId, session)
  }

  getTotalActiveConnections(): number {
    return Array.from(this.workflowRooms.values()).reduce(
      (total, room) => total + room.activeConnections,
      0
    )
  }

  broadcastPresenceUpdate(workflowId: string): void {
    const room = this.workflowRooms.get(workflowId)
    if (room) {
      const roomPresence = Array.from(room.users.values())
      this.io.to(workflowId).emit('presence-update', roomPresence)
    }
  }

  /**
   * Get the number of unique users in a workflow room
   * (not the number of socket connections)
   */
  getUniqueUserCount(workflowId: string): number {
    const room = this.workflowRooms.get(workflowId)
    if (!room) return 0

    const uniqueUsers = new Set<string>()
    room.users.forEach((presence) => {
      uniqueUsers.add(presence.userId)
    })

    return uniqueUsers.size
  }
}
