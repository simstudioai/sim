import type { ResourceEntityType } from '@sim/auth/principal'
import type { WorkspaceFileRow } from '@sim/db/schema'

/** Persisted ownership is independent of creator attribution and caller authority. */
export interface FileOwner {
  entityType: ResourceEntityType
  entityId: string
}

/** Owners whose durable files support the shared Files editor and folder lifecycle. */
export interface EditableFileOwner {
  entityType: 'workspace' | 'project'
  entityId: string
}

type PersistedFileOwnership = Pick<
  WorkspaceFileRow,
  'entityType' | 'entityId' | 'context' | 'workspaceId' | 'organizationId' | 'userId' | 'chatId'
>

function resolveLegacyFileOwner(file: PersistedFileOwnership): FileOwner | null {
  if (file.organizationId === null && file.workspaceId) {
    switch (file.context) {
      case 'workspace':
      case 'mothership':
      case 'execution':
      case 'workspace-logos':
      case 'knowledge-base':
        return { entityType: 'workspace', entityId: file.workspaceId }
    }
  }
  if (file.context === 'knowledge-base' && file.workspaceId === null && file.organizationId) {
    return { entityType: 'organization', entityId: file.organizationId }
  }
  if (
    (file.context === 'copilot' || file.context === 'profile-pictures') &&
    file.workspaceId === null &&
    file.organizationId === null &&
    file.userId
  ) {
    return { entityType: 'user', entityId: file.userId }
  }
  return null
}

/**
 * Resolves the persisted pair without repairing conflicts or granting access.
 * During expansion, an absent pair uses only the audited legacy mappings from
 * `workspace_file_legacy_entity`; unclassified contexts remain unresolved.
 */
export function resolveFileOwner(file: PersistedFileOwnership): FileOwner | null {
  if (file.entityType === null && file.entityId === null) return resolveLegacyFileOwner(file)
  if (file.entityType === null || !file.entityId) return null

  if (file.entityType === 'project') {
    if (
      file.context !== 'project' ||
      file.workspaceId !== null ||
      file.organizationId !== null ||
      file.chatId !== null
    ) {
      return null
    }
    return { entityType: 'project', entityId: file.entityId }
  }

  const legacyOwner = resolveLegacyFileOwner(file)
  if (
    !legacyOwner ||
    legacyOwner.entityType !== file.entityType ||
    legacyOwner.entityId !== file.entityId
  ) {
    return null
  }
  return legacyOwner
}
