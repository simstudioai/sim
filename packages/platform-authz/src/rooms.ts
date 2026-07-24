import { db, workspace, workspaceFiles } from '@sim/db'
import { ROOM_TYPES, type RoomRef, type RoomType } from '@sim/realtime-protocol/rooms'
import { and, eq, isNull } from 'drizzle-orm'
import { getActiveWorkflowContext } from './workflow'
import {
  type PermissionType,
  permissionSatisfies,
  resolveEffectiveWorkspacePermission,
} from './workspace'

export type { PermissionType, RoomRef, RoomType }

/**
 * The owning workspace of a room, plus the org that owns that workspace — the
 * exact inputs {@link resolveEffectiveWorkspacePermission} needs.
 */
export interface RoomWorkspace {
  workspaceId: string
  workspaceOrganizationId: string | null
}

/**
 * Resolves a room's owning workspace from its {@link RoomRef.id}. Returns `null`
 * when the underlying resource is missing/archived (→ a 404 authorization
 * result). One resolver per {@link RoomType}; this is the single place a new
 * room type declares its resource→workspace lookup.
 */
export type RoomWorkspaceResolver = (roomId: string) => Promise<RoomWorkspace | null>

async function resolveWorkspaceRoomWorkspace(workspaceId: string): Promise<RoomWorkspace | null> {
  const [row] = await db
    .select({ id: workspace.id, organizationId: workspace.organizationId })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)

  return row ? { workspaceId: row.id, workspaceOrganizationId: row.organizationId } : null
}

/**
 * Resolves a collaborative file-document room to its owning workspace. The room
 * id is the file id; look up its (active) workspace file, then reuse the
 * workspace resolver so archival is honored uniformly. Returns `null` when the
 * file is missing/soft-deleted or is not workspace-scoped (copilot/chat uploads
 * carry a null `workspaceId` and have no collaborative editor).
 */
async function resolveFileDocWorkspace(fileId: string): Promise<RoomWorkspace | null> {
  const [file] = await db
    .select({ workspaceId: workspaceFiles.workspaceId })
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.id, fileId), isNull(workspaceFiles.deletedAt)))
    .limit(1)

  if (!file?.workspaceId) return null
  return resolveWorkspaceRoomWorkspace(file.workspaceId)
}

/**
 * Single source of truth mapping each room type to its resource→workspace
 * lookup. Every realtime room is workspace-scoped and authorizes through the
 * same effective-permission resolver, so a room type only has to say *which*
 * workspace it belongs to. Adding a room type = adding one entry here.
 */
const ROOM_WORKSPACE_RESOLVERS: Record<RoomType, RoomWorkspaceResolver> = {
  [ROOM_TYPES.WORKFLOW]: async (workflowId) => {
    const context = await getActiveWorkflowContext(workflowId)
    if (!context?.workspaceId) return null
    return {
      workspaceId: context.workspaceId,
      workspaceOrganizationId: context.workspaceOrganizationId,
    }
  },
  // A workspace-files room is addressed directly by its workspace id.
  [ROOM_TYPES.WORKSPACE_FILES]: resolveWorkspaceRoomWorkspace,
  // A file-doc room is addressed by file id; resolve it to its workspace.
  [ROOM_TYPES.WORKSPACE_FILE_DOC]: resolveFileDocWorkspace,
}

/** Resolves a room's owning workspace, or `null` if the room resource is gone. */
export function resolveWorkspaceIdForRoom(room: RoomRef): Promise<RoomWorkspace | null> {
  return ROOM_WORKSPACE_RESOLVERS[room.type](room.id)
}

export interface RoomAuthorizationResult {
  allowed: boolean
  status: number
  message?: string
  workspaceId: string | null
  workspacePermission: PermissionType | null
}

/**
 * Authorizes a user against a realtime room. Mirrors
 * `authorizeWorkflowByWorkspacePermission` (the exemplary workflow authorizer)
 * but generalized over room type: resolve the room's workspace, then gate on the
 * user's effective workspace permission under the read < write < admin ordering.
 *
 * Returns a denial (never throws) for unknown room type (400), missing/archived
 * resource (404), and insufficient permission (403), so realtime handlers and
 * SSE routes can map the `status` to a wire error uniformly.
 */
export async function authorizeRoom(params: {
  userId: string
  room: RoomRef
  action?: PermissionType
}): Promise<RoomAuthorizationResult> {
  const { userId, room, action = 'read' } = params

  const resolver = ROOM_WORKSPACE_RESOLVERS[room.type]
  if (!resolver) {
    return {
      allowed: false,
      status: 400,
      message: `Unknown room type: ${room.type}`,
      workspaceId: null,
      workspacePermission: null,
    }
  }

  const roomWorkspace = await resolver(room.id)
  if (!roomWorkspace) {
    return {
      allowed: false,
      status: 404,
      message: 'Room not found',
      workspaceId: null,
      workspacePermission: null,
    }
  }

  const workspacePermission = await resolveEffectiveWorkspacePermission(
    userId,
    roomWorkspace.workspaceId,
    roomWorkspace.workspaceOrganizationId
  )

  if (!permissionSatisfies(workspacePermission, action)) {
    return {
      allowed: false,
      status: 403,
      message: `Access denied to ${action} this room`,
      workspaceId: roomWorkspace.workspaceId,
      workspacePermission,
    }
  }

  return {
    allowed: true,
    status: 200,
    workspaceId: roomWorkspace.workspaceId,
    workspacePermission,
  }
}
