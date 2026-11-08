'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useUserPermissions } from '@/hooks/use-user-permissions'

/**
 * What the viewer may do with a workspace's knowledge bases: write and admin access from their
 * workspace role, and the permission group's knowledge gates. Hiding is navigation; every write
 * behind these flags is authorized again by its API.
 */
export function useKnowledgeAccess(workspaceId: string) {
  const permissionsQuery = useWorkspacePermissionsQuery(workspaceId)
  const permissions = useUserPermissions(
    permissionsQuery.data ?? null,
    permissionsQuery.isLoading,
    permissionsQuery.error ? getErrorMessage(permissionsQuery.error) : null
  )
  const config = useUserPermissionConfig(workspaceId).data?.config
  return {
    canEdit: permissions.canEdit,
    canAdmin: permissions.canAdmin,
    /** True until the viewer's role is known, so a write stays unavailable rather than flickering. */
    isLoading: permissions.isLoading,
    hidden: config?.hideKnowledgeBaseTab === true,
    exportDisabled: config?.disableKnowledgeBaseExport === true,
  }
}
