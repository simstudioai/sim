import type { RoomAuthorizationResult } from '@sim/platform-authz/rooms'
import { FILE_DOC_INTERNAL_HEADERS, FILE_DOC_TIMEOUTS } from '@sim/realtime-protocol/file-doc'
import { type ProjectRoomRef, projectFileDocTarget, ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { toRecord } from '@sim/utils/object'
import { env, getBaseUrl } from '@/env'
import { fetchProjectFileDocAccess } from '@/handlers/file-doc-app'

/** Each Project room revalidates through its own bounded semantic app operation. */
export async function fetchProjectRoomAccess(
  room: ProjectRoomRef,
  actor: { userId: string; connectionId: string }
): Promise<RoomAuthorizationResult & { docId?: string | null }> {
  switch (room.type) {
    case ROOM_TYPES.PROJECT_FILE_DOC: {
      const target = projectFileDocTarget(room)
      if (!target) throw new Error('Invalid Project document target')
      return fetchProjectFileDocAccess({ ...target, ...actor })
    }
    case ROOM_TYPES.PROJECT_FILES: {
      if (!room.id || room.id.length > 200 || /[/:\s]/.test(room.id)) {
        throw new Error('Invalid Project collection target')
      }
      const response = await fetch(
        `${getBaseUrl()}/api/internal/project-file-list/${encodeURIComponent(room.id)}/access`,
        {
          method: 'POST',
          headers: {
            'x-api-key': env.INTERNAL_API_SECRET,
            [FILE_DOC_INTERNAL_HEADERS.userId]: actor.userId,
            [FILE_DOC_INTERNAL_HEADERS.connectionId]: actor.connectionId,
          },
          signal: AbortSignal.timeout(FILE_DOC_TIMEOUTS.seedRequestMs),
        }
      )
      if ([403, 404, 409].includes(response.status)) {
        await response.body?.cancel()
        return {
          allowed: false,
          status: response.status === 409 ? 404 : response.status,
          workspaceId: null,
          workspacePermission: null,
        }
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Project collection authorization failed: ${response.status}`)
      }
      const result = toRecord(await response.json())
      if (result.projectId !== room.id || result.canRead !== true) {
        throw new Error('Project collection authorization returned an invalid target')
      }
      return { allowed: true, status: 200, workspaceId: null, workspacePermission: 'read' }
    }
    default: {
      const unknownType: never = room.type
      throw new Error(`Unsupported Project room ${unknownType}`)
    }
  }
}
