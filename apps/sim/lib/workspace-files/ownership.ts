import type { ResourceEntityType } from '@sim/auth/principal'
import type { WorkspaceFileRow } from '@sim/db/schema'

/** Persisted ownership is independent of creator attribution and caller authority. */
export interface FileOwner {
  entityType: ResourceEntityType
  entityId: string
}

/** An asserted file target; application authorization verifies its persisted owner. */
export interface OwnedFileTarget {
  owner: FileOwner
  fileId: string
}

/** Owners whose durable files support the shared Files editor and folder lifecycle. */
export interface EditableFileOwner {
  entityType: 'workspace' | 'project'
  entityId: string
}

type PersistedFileOwnership = Pick<
  WorkspaceFileRow,
  'projectId' | 'context' | 'workspaceId' | 'organizationId' | 'userId' | 'chatId'
>

/** Maps editable owners to their mutually exclusive persistence columns. */
export function editableFileOwnerColumns(owner: EditableFileOwner) {
  return {
    workspaceId: owner.entityType === 'workspace' ? owner.entityId : null,
    projectId: owner.entityType === 'project' ? owner.entityId : null,
  }
}

/** Resolves canonical foreign keys without granting access or guessing unclassified contexts. */
export function resolveFileOwner(file: PersistedFileOwnership): FileOwner | null {
  const owners = [file.workspaceId, file.projectId, file.organizationId]
  if (owners.some((id) => id === '') || owners.filter((id) => id != null).length > 1) return null
  if (file.projectId) {
    return file.context === 'project' && file.chatId === null
      ? { entityType: 'project', entityId: file.projectId }
      : null
  }
  if (file.workspaceId) {
    switch (file.context) {
      case 'workspace':
      case 'chat':
      case 'mothership':
      case 'execution':
      case 'workspace-logos':
      case 'knowledge-base':
        return { entityType: 'workspace', entityId: file.workspaceId }
    }
  }
  if (file.context === 'knowledge-base' && file.organizationId) {
    return { entityType: 'organization', entityId: file.organizationId }
  }
  if (
    (file.context === 'copilot' || file.context === 'profile-pictures') &&
    file.workspaceId === null &&
    file.projectId === null &&
    file.organizationId === null &&
    file.userId
  ) {
    return { entityType: 'user', entityId: file.userId }
  }
  return null
}
