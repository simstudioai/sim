'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useUserPermissions } from '@/hooks/use-user-permissions'

/**
 * Whether the viewer may run the workspace's tests: running needs edit access to the workspace, as
 * on the legacy page. The run API authorizes the same rule again.
 */
export function useWorkflowTestsAccess(workspaceId: string) {
  const permissions = useWorkspacePermissionsQuery(workspaceId)
  const viewer = useUserPermissions(
    permissions.data ?? null,
    permissions.isLoading,
    permissions.error ? getErrorMessage(permissions.error) : null
  )
  return { canEdit: viewer.canEdit }
}
