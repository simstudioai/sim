import { isRecordLike } from '@sim/utils/object'

/** Derives the file address understood by cached browsers without changing canonical storage. */
export function presentChatResourceForBrowser<T>(resource: T): T {
  if (
    !isRecordLike(resource) ||
    (resource.type !== 'file' && resource.type !== 'filefolder') ||
    !isRecordLike(resource.owner) ||
    resource.owner.entityType !== 'workspace' ||
    typeof resource.owner.entityId !== 'string' ||
    !resource.owner.entityId.trim() ||
    resource.workspaceId === resource.owner.entityId
  )
    return resource
  return { ...resource, workspaceId: resource.owner.entityId }
}
