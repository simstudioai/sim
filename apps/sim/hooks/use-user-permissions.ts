import { useMemo } from 'react'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { type PermissionType, useWorkspacePermissions } from './use-workspace-permissions'

const logger = createLogger('useUserPermissions')

export interface WorkspaceUserPermissions {
  // Core permission checks
  canRead: boolean
  canEdit: boolean
  canAdmin: boolean

  // Utility properties
  userPermissions: PermissionType
  isLoading: boolean
  error: string | null
}

/**
 * Custom hook to check current user's permissions within a workspace
 *
 * @param workspaceId - The workspace ID to check permissions for
 * @returns Object containing permission flags and utility properties
 */
export function useUserPermissions(workspaceId: string | null): WorkspaceUserPermissions {
  const { data: session } = useSession()
  const { permissions, loading, error } = useWorkspacePermissions(workspaceId)

  const userPermissions = useMemo((): WorkspaceUserPermissions => {
    // If still loading or no session, return safe defaults
    if (loading || !session?.user?.email) {
      return {
        canRead: false,
        canEdit: false,
        canAdmin: false,
        userPermissions: 'read',
        isLoading: loading,
        error,
      }
    }

    // Find current user in workspace permissions
    const currentUser = permissions?.users?.find((user) => user.email === session.user.email)

    // If user not found in workspace, they have no permissions
    if (!currentUser) {
      logger.warn('User not found in workspace permissions', {
        userEmail: session.user.email,
        workspaceId,
        hasPermissions: !!permissions,
        userCount: permissions?.users?.length || 0,
      })

      return {
        canRead: false,
        canEdit: false,
        canAdmin: false,
        userPermissions: 'read',
        isLoading: false,
        error: error || 'User not found in workspace',
      }
    }

    const userPerms = currentUser.permissionType || 'read'

    // Core permission checks
    const canAdmin = userPerms === 'admin'
    const canEdit = userPerms === 'write' || userPerms === 'admin'
    const canRead = true // If user is found in workspace permissions, they have read access

    return {
      canRead,
      canEdit,
      canAdmin,
      userPermissions: userPerms,
      isLoading: false,
      error,
    }
  }, [session, permissions, loading, error, workspaceId])

  return userPermissions
}
