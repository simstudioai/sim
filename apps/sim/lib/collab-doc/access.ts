import { authorizeRoom, type RoomAuthorizationResult } from '@sim/platform-authz/rooms'
import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import {
  capabilityRefusal,
  isWorkspaceCapabilityWithheld,
} from '@/lib/permission-groups/capability-assertions'

/**
 * Whether `userId` may occupy a workspace file's collaborative document room.
 *
 * The room streams the file's content to every member and persists their edits, so it answers to
 * the Files capability exactly as the HTTP file operations do. A withheld capability carries no
 * permission, because the relay caches whatever permission a refusal reports and its write gate
 * reads that cache.
 */
export async function authorizeFileDocAccess(
  userId: string,
  fileId: string
): Promise<RoomAuthorizationResult> {
  const authorization = await authorizeRoom({
    userId,
    room: { type: ROOM_TYPES.WORKSPACE_FILE_DOC, id: fileId },
  })
  if (!authorization.allowed || !authorization.workspaceId) return authorization

  // permission-group-enforced: files.use — the document room carries the file's content both ways.
  if (await isWorkspaceCapabilityWithheld(userId, authorization.workspaceId, 'files.use')) {
    return {
      allowed: false,
      status: 403,
      message: capabilityRefusal('files.use'),
      workspaceId: authorization.workspaceId,
      workspacePermission: null,
    }
  }
  return authorization
}
