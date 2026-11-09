'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useUserPermissions } from '@/hooks/use-user-permissions'

/** The permission-group flag that hides a resource tab. */
type ResourceTabGate = 'hideTablesTab' | 'hideFilesTab' | 'hideKnowledgeBaseTab'

/**
 * What the viewer may do on a workspace resource list: edit or administer from their workspace
 * role, and whether their permission group hides the tab. Hiding is navigation; every write behind
 * these flags is authorized again by its API.
 */
export function useResourceListAccess(workspaceId: string, gate: ResourceTabGate) {
  const permissions = useWorkspacePermissionsQuery(workspaceId)
  const viewer = useUserPermissions(
    permissions.data ?? null,
    permissions.isLoading,
    permissions.error ? getErrorMessage(permissions.error) : null
  )
  const policy = useUserPermissionConfig(workspaceId)
  const config = policy.data?.config ?? DEFAULT_PERMISSION_GROUP_CONFIG
  return {
    canEdit: viewer.canEdit,
    canAdmin: viewer.canAdmin,
    hidden: config[gate],
    exportDisabled: config.disableKnowledgeBaseExport,
    /** The policy has answered, so a hidden tab never shows its content first. */
    settled: !policy.isPending,
    /** Reads the policy again, once an administrator may have restored access. */
    refresh: () => void policy.refetch(),
  }
}
