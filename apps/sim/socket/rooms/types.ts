import type { Server } from 'socket.io'

/**
 * User presence data stored in room state
 */
export interface UserPresence {
  userId: string
  workflowId: string
  userName: string
  socketId: string
  tabSessionId?: string
  joinedAt: number
  lastActivity: number
  role: string
  cursor?: { x: number; y: number }
  selection?: { type: 'block' | 'edge' | 'none'; id?: string }
  avatarUrl?: string | null
}

/**
 * User session data (minimal info for quick lookups)
 */
export interface UserSession {
  userId: string
  userName: string
  avatarUrl?: string | null
}

/**
 * Workflow room state
 */
export interface WorkflowRoom {
  workflowId: string
  users: Map<string, UserPresence>
  lastModified: number
  activeConnections: number
}

/**
 * Common interface for room managers (in-memory and Redis)
 * All methods that access state are async to support Redis operations
 */
export interface IRoomManager {
  readonly io: Server

  /**
   * Initialize the room manager (connect to Redis, etc.)
   */
  initialize(): Promise<void>

  /**
   * Whether the room manager is ready to serve requests
   */
  isReady(): boolean

  /**
   * Clean shutdown
   */
  shutdown(): Promise<void>

  /**
   * Add a user to a workflow room
   */
  addUserToRoom(workflowId: string, socketId: string, presence: UserPresence): Promise<void>

  /**
   * Remove a user from their current room
   * Optional workflowIdHint is used when socket mapping keys are missing/expired.
   * Returns the workflowId they were in, or null if not in any room.
   */
  removeUserFromRoom(socketId: string, workflowIdHint?: string): Promise<string | null>

  /**
   * Get the workflow ID for a socket
   */
  getWorkflowIdForSocket(socketId: string): Promise<string | null>

  /**
   * Get user session data for a socket
   */
  getUserSession(socketId: string): Promise<UserSession | null>

  /**
   * Get all users in a workflow room
   */
  getWorkflowUsers(workflowId: string): Promise<UserPresence[]>

  /**
   * Check if a workflow room exists
   */
  hasWorkflowRoom(workflowId: string): Promise<boolean>

  /**
   * Update user activity (cursor, selection, lastActivity)
   */
  updateUserActivity(
    workflowId: string,
    socketId: string,
    updates: Partial<Pick<UserPresence, 'cursor' | 'selection' | 'lastActivity'>>
  ): Promise<void>

  /**
   * Update room's lastModified timestamp
   */
  updateRoomLastModified(workflowId: string): Promise<void>

  /**
   * Broadcast presence update to all clients in a workflow room
   */
  broadcastPresenceUpdate(workflowId: string): Promise<void>

  /**
   * Emit an event to all clients in a workflow room
   */
  emitToWorkflow<T = unknown>(workflowId: string, event: string, payload: T): void

  /**
   * Get the number of unique users in a workflow room
   */
  getUniqueUserCount(workflowId: string): Promise<number>

  /**
   * Get total active connections across all rooms
   */
  getTotalActiveConnections(): Promise<number>

  /**
   * Handle workflow deletion - notify users and clean up room
   */
  handleWorkflowDeletion(workflowId: string): Promise<void>

  /**
   * Handle workflow revert - notify users
   */
  handleWorkflowRevert(workflowId: string, timestamp: number): Promise<void>

  /**
   * Handle workflow update - notify users
   */
  handleWorkflowUpdate(workflowId: string): Promise<void>
}
