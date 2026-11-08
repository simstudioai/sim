'use client'

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useUserPermissions } from '@/hooks/use-user-permissions'

/**
 * What the viewer may do with a workspace's files: write access from their workspace role, and the
 * admin policy that governs sharing. The API enforces both; these only decide what is offered.
 */
export function useFileAccess(workspaceId: string) {
  const permissions = useWorkspacePermissionsQuery(workspaceId)
  const viewer = useUserPermissions(
    permissions.data ?? null,
    permissions.isLoading,
    permissions.error?.message ?? null
  )
  const { data: policy } = useUserPermissionConfig(workspaceId)
  const config = policy?.config ?? DEFAULT_PERMISSION_GROUP_CONFIG
  return {
    canEdit: viewer.canEdit,
    /** `null` allows every method. */
    allowedShareAuthTypes: config.allowedFileShareAuthTypes,
    disablePublicSharing: config.disablePublicFileSharing,
    hideFiles: config.hideFilesTab,
  }
}
