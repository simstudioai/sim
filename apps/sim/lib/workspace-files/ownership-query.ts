import { folder, workspaceFiles } from '@sim/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

/** Selects only coherent canonical ownership, independent of creator and purpose. */
export function fileOwnerCondition(owner: EditableFileOwner, includeChatUploads = false) {
  if (owner.entityType === 'project') {
    return and(
      eq(workspaceFiles.projectId, owner.entityId),
      eq(workspaceFiles.context, 'project'),
      isNull(workspaceFiles.workspaceId),
      isNull(workspaceFiles.organizationId),
      isNull(workspaceFiles.chatId)
    )
  }
  return and(
    eq(workspaceFiles.workspaceId, owner.entityId),
    isNull(workspaceFiles.organizationId),
    includeChatUploads
      ? inArray(workspaceFiles.context, ['workspace', 'mothership'])
      : eq(workspaceFiles.context, 'workspace'),
    isNull(workspaceFiles.projectId)
  )
}

/** Other folder resource types remain workspace-only and are never selected as editable file folders. */
export function fileFolderOwnerCondition(owner: EditableFileOwner) {
  return and(
    eq(folder.resourceType, 'file'),
    owner.entityType === 'workspace'
      ? eq(folder.workspaceId, owner.entityId)
      : eq(folder.projectId, owner.entityId)
  )
}
