import { folder, workspaceFiles } from '@sim/db/schema'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

/** Selects only coherent canonical ownership, including the audited workspace expansion fallback. */
export function fileOwnerCondition(owner: EditableFileOwner, includeChatUploads = false) {
  if (owner.entityType === 'project') {
    return and(
      eq(workspaceFiles.entityType, 'project'),
      eq(workspaceFiles.entityId, owner.entityId),
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
    or(
      and(isNull(workspaceFiles.entityType), isNull(workspaceFiles.entityId)),
      and(eq(workspaceFiles.entityType, 'workspace'), eq(workspaceFiles.entityId, owner.entityId))
    )
  )
}

/** Other folder resource types remain workspace-only and are never selected as editable file folders. */
export function fileFolderOwnerCondition(owner: EditableFileOwner) {
  return and(
    eq(folder.resourceType, 'file'),
    owner.entityType === 'workspace'
      ? and(
          eq(folder.workspaceId, owner.entityId),
          or(
            and(isNull(folder.entityType), isNull(folder.entityId)),
            and(eq(folder.entityType, 'workspace'), eq(folder.entityId, owner.entityId))
          )
        )
      : and(
          isNull(folder.workspaceId),
          eq(folder.entityType, 'project'),
          eq(folder.entityId, owner.entityId)
        )
  )
}
