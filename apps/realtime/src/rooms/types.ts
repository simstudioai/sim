import type { RoomRef, RoomType } from '@sim/realtime-protocol/rooms'
import type { Server } from 'socket.io'

/**
 * User presence data stored in room state.
 *
 * `room` is the generic room address (see `@sim/realtime-protocol/rooms`). A
 * socket may hold presence in more than one room, but only one room per type.
 */
export interface UserPresence {
  userId: string
  room: RoomRef
  userName: string
  socketId: string
  tabSessionId?: string
  joinedAt: number
  lastActivity: number
  role: string
  cursor?: { x: number; y: number }
  selection?: { type: 'block' | 'edge' | 'none'; id?: string }
  avatarUrl?: string | null
  /**
   * The subfolder the user is viewing, recorded at join for room types that track
   * a per-viewer location (e.g. the workspace file browser). `null` is the root.
   */
  folderId?: string | null
}

/**
 * User session data (minimal info for quick lookups). Shared across all rooms a
 * socket is in — keyed by socket, not by room.
 */
export interface UserSession {
  userId: string
  userName: string
  avatarUrl?: string | null
}

/**
 * Room presence state.
 */
export interface RoomState {
  room: RoomRef
  users: Map<string, UserPresence>
  lastModified: number
  activeConnections: number
}

/**
 * Common interface for room managers (in-memory and Redis).
 *
 * The manager is domain-neutral: it tracks room membership and presence keyed by
 * {@link RoomRef}, and knows nothing about workflows, files, or any specific
 * domain. Domain lifecycle concerns (e.g. workflow deletion/deploy broadcasts)
 * live in domain services that compose a manager — see `WorkflowRoomService`.
 *
 * A socket may occupy multiple rooms, at most one per {@link RoomType}. The
 * shared session key is dropped only when a socket leaves its last room.
 *
 * All state-accessing methods are async to support the Redis implementation.
 */
export interface IRoomManager {
  readonly io: Server

  /** Initialize the manager (connect to Redis, load scripts, etc.). */
  initialize(): Promise<void>

  /** Whether the manager is ready to serve requests. */
  isReady(): boolean

  /** Clean shutdown. */
  shutdown(): Promise<void>

  /** Add a socket's presence to a room. */
  addUserToRoom(room: RoomRef, socketId: string, presence: UserPresence): Promise<void>

  /**
   * Remove a socket from a single room. Returns `true` if it was a member. The
   * shared session is dropped only if this was the socket's last room.
   */
  removeUserFromRoom(room: RoomRef, socketId: string): Promise<boolean>

  /**
   * Remove a socket from every room it occupies (disconnect). Returns the rooms
   * it was in, so the caller can rebroadcast presence per room.
   */
  removeSocketFromAllRooms(socketId: string): Promise<RoomRef[]>

  /** Every room the socket currently occupies. */
  getRoomsForSocket(socketId: string): Promise<RoomRef[]>

  /** The socket's room of a given type (at most one per type), or `null`. */
  getRoomForSocket(socketId: string, type: RoomType): Promise<RoomRef | null>

  /** Session data for a socket (shared across its rooms). */
  getUserSession(socketId: string): Promise<UserSession | null>

  /** All users present in a room. */
  getRoomUsers(room: RoomRef): Promise<UserPresence[]>

  /** Whether a room currently has any presence. */
  hasRoom(room: RoomRef): Promise<boolean>

  /**
   * Unconditionally drop all state for a room (presence + metadata). Used when a
   * room's underlying resource is destroyed (e.g. a deleted workflow) to guarantee
   * no state lingers even if per-socket removals failed or a socket joined mid-teardown.
   */
  deleteRoom(room: RoomRef): Promise<void>

  /** Update a socket's activity (cursor, selection, lastActivity) within a room. */
  updateUserActivity(
    room: RoomRef,
    socketId: string,
    updates: Partial<Pick<UserPresence, 'cursor' | 'selection' | 'lastActivity'>>
  ): Promise<void>

  /** Bump a room's lastModified timestamp. */
  updateRoomLastModified(room: RoomRef): Promise<void>

  /**
   * Broadcast the room's presence list to all clients in the room. Pass
   * `excludeSocketId` (e.g. a disconnecting socket) to omit that socket from the
   * broadcast even if its presence entry outlived a failed removal — so it is
   * never shown as a ghost collaborator.
   */
  broadcastPresenceUpdate(room: RoomRef, excludeSocketId?: string): Promise<void>

  /** Emit an event to all clients in a room. */
  emitToRoom<T = unknown>(room: RoomRef, event: string, payload: T): void

  /** Number of unique users in a room. */
  getUniqueUserCount(room: RoomRef): Promise<number>

  /** Total active connections tracked by this instance. */
  getTotalActiveConnections(): Promise<number>
}
