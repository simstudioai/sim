'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useUserPermissions } from '@/hooks/use-user-permissions'

/**
 * The viewer's role in a workspace, as the legacy workspace permissions provider resolves it, for a
 * zone page that mounts no provider: `canEdit` for writers and admins, `canAdmin` for admins only.
 * Everything reads `false` while the session or the roster is loading.
 */
export function useWorkspaceUserPermissions(workspaceId: string) {
  const query = useWorkspacePermissionsQuery(workspaceId)
  return useUserPermissions(
    query.data ?? null,
    query.isLoading,
    query.error ? getErrorMessage(query.error, 'Failed to load workspace permissions') : null
  )
}
