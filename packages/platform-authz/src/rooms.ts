import { db, userTableDefinitions, workspace, workspaceFiles } from '@sim/db'
import { ROOM_TYPES, type RoomRef, type RoomType } from '@sim/realtime-protocol/rooms'
import { and, eq, isNull } from 'drizzle-orm'
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
 * result). One resolver per workspace-scoped {@link RoomType}; this is the single
 * place a new such room type declares its resource→workspace lookup.
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
 * Resolves a table presence room to its owning workspace. The room id is the
 * table id; look up its (non-archived) definition, then reuse the workspace
 * resolver so archival is honored uniformly. Returns `null` when the table is
 * missing or archived.
 */
async function resolveTableWorkspace(tableId: string): Promise<RoomWorkspace | null> {
  const [table] = await db
    .select({ workspaceId: userTableDefinitions.workspaceId })
    .from(userTableDefinitions)
    .where(and(eq(userTableDefinitions.id, tableId), isNull(userTableDefinitions.archivedAt)))
    .limit(1)

  if (!table?.workspaceId) return null
  return resolveWorkspaceRoomWorkspace(table.workspaceId)
}

/**
 * Maps each workspace-scoped room type to its resource→workspace lookup. These
 * rooms authorize uniformly through {@link authorizeRoom}: resolve *which*
 * workspace the room belongs to, then gate on effective workspace permission.
 *
 * Workflow is intentionally absent: it authorizes through its own dedicated path
 * (`authorizeWorkflowByWorkspacePermission` + the realtime role cache in
 * `middleware/permissions`) and never flows through {@link authorizeRoom}. A
 * workflow ref reaching here is therefore an unknown type (400) by design.
 * Adding a *workspace-scoped* room type = adding one entry here.
 */
const ROOM_WORKSPACE_RESOLVERS: Partial<Record<RoomType, RoomWorkspaceResolver>> = {
  // A workspace-files room is addressed directly by its workspace id.
  [ROOM_TYPES.WORKSPACE_FILES]: resolveWorkspaceRoomWorkspace,
  // A workspace-tables room is addressed directly by its workspace id.
  [ROOM_TYPES.WORKSPACE_TABLES]: resolveWorkspaceRoomWorkspace,
  // A file-doc room is addressed by file id; resolve it to its workspace.
  [ROOM_TYPES.WORKSPACE_FILE_DOC]: resolveFileDocWorkspace,
  // A table room is addressed by table id; resolve it to its workspace.
  [ROOM_TYPES.TABLE]: resolveTableWorkspace,
}

export interface RoomAuthorizationResult {
  allowed: boolean
  status: number
  message?: string
  workspaceId: string | null
  workspacePermission: PermissionType | null
}

/**
 * Authorizes a user against a workspace-scoped realtime room (workspace-files,
 * file-doc, table). Mirrors `authorizeWorkflowByWorkspacePermission` (the
 * exemplary workflow authorizer) but generalized over room type: resolve the
 * room's workspace, then gate on the user's effective workspace permission under
 * the read < write < admin ordering. Workflow rooms use their own authorizer and
 * do not pass through here (see {@link ROOM_WORKSPACE_RESOLVERS}).
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
    // Either an unknown type or one deliberately outside this authorizer (workflow authorizes via
    // its own path); both are not-authorizable-here → 400.
    return {
      allowed: false,
      status: 400,
      message: `Room type not authorizable here: ${room.type}`,
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
