import type { OperationTarget, SocketOperation } from './constants'
import type { RoomRef } from './rooms'

/**
 * Wire types for the broadcast/confirmation events the realtime Socket.IO server
 * emits to clients. These mirror the exact object literals emitted by
 * `apps/realtime/src/handlers/**` and `apps/realtime/src/rooms/**`, and are the
 * canonical types consumed by the client socket transport
 * (`apps/sim/app/workspace/providers/socket-provider.tsx`).
 *
 * Payload bodies that the transport forwards opaquely are typed `unknown` rather
 * than a concrete operation union, because the transport never narrows them — the
 * collaborative-workflow consumer dispatches on `operation`/`target` itself.
 */

/** A live-presence cursor position broadcast over the socket. */
export interface CursorPosition {
  x: number
  y: number
}

/** A live-presence selection broadcast over the socket. */
export interface PresenceSelection {
  type: 'block' | 'edge' | 'none'
  id?: string
}

/**
 * `workflow-operation` broadcast. The server re-broadcasts the originating
 * operation envelope plus sender identity and operation metadata.
 */
export interface WorkflowOperationBroadcast {
  operation: SocketOperation | string
  target: OperationTarget | string
  payload: unknown
  timestamp: number
  senderId: string
  userId: string
  userName: string
  metadata: {
    workflowId: string
    operationId: string
    isPositionUpdate?: boolean
    isBatchPositionUpdate?: boolean
  }
}

/** `subblock-update` broadcast. */
export interface SubblockUpdateBroadcast {
  workflowId: string
  blockId: string
  subblockId: string
  value: unknown
  timestamp: number
}

/** `variable-update` broadcast. */
export interface VariableUpdateBroadcast {
  workflowId: string
  variableId: string
  field: string
  value: unknown
  timestamp: number
}

/** `cursor-update` presence broadcast for a single remote user. */
export interface CursorUpdateBroadcast {
  socketId: string
  userId: string
  userName: string
  avatarUrl?: string | null
  /** `null` when the remote user's cursor leaves the canvas (the client emits `{ cursor: null }`). */
  cursor: CursorPosition | null
}

/** `selection-update` presence broadcast for a single remote user. */
export interface SelectionUpdateBroadcast {
  socketId: string
  userId: string
  userName: string
  avatarUrl?: string | null
  selection: PresenceSelection
}

/** `workflow-deleted` lifecycle broadcast. */
export interface WorkflowDeletedBroadcast {
  workflowId: string
  message: string
  timestamp: number
}

/** `workflow-reverted` lifecycle broadcast. */
export interface WorkflowRevertedBroadcast {
  workflowId: string
  message: string
  timestamp: number
}

/** `workflow-updated` lifecycle broadcast. */
export interface WorkflowUpdatedBroadcast {
  workflowId: string
  message: string
  timestamp: number
}

/** `workflow-deployed` lifecycle broadcast. */
export interface WorkflowDeployedBroadcast {
  workflowId: string
  timestamp: number
}

/**
 * `access-revoked` broadcast. Emitted to a single socket when its owner's live
 * read access to the workflow has been revoked (workspace permission removed or
 * downgraded to no access), forcing that client to leave the room and clear its
 * editor state. Unlike the lifecycle broadcasts above, this targets one socket
 * rather than the whole room — only the revoked user is evicted.
 */
export interface AccessRevokedBroadcast {
  workflowId: string
  message: string
  timestamp: number
}

/**
 * `room-access-revoked` broadcast — the non-workflow counterpart of
 * {@link AccessRevokedBroadcast}. Emitted to a single socket when its owner's
 * workspace permission no longer satisfies the room it occupies (removed, or
 * downgraded below the room's required level), after the server has already
 * evicted it. Carries the generic {@link RoomRef} rather than a workflow id
 * because one socket can hold several rooms of different types at once, so the
 * client must be told exactly which one it lost.
 *
 * Kept as a separate event from `access-revoked` so existing workflow clients —
 * which read `data.workflowId` — are never handed a payload they would misparse.
 */
export interface RoomAccessRevokedBroadcast {
  room: RoomRef
  message: string
  timestamp: number
}

/** Wire event name carrying a {@link RoomAccessRevokedBroadcast}. */
export const ROOM_ACCESS_REVOKED_EVENT = 'room-access-revoked'

/** `operation-confirmed` ack for a previously-emitted operation. */
export interface OperationConfirmedBroadcast {
  operationId: string
  serverTimestamp: number
}

/** `operation-failed` rejection for a previously-emitted operation. */
export interface OperationFailedBroadcast {
  operationId: string
  error: string
  retryable?: boolean
}
