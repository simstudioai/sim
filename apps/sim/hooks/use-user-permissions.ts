import { useMemo } from 'react'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import type { PermissionType, WorkspacePermissions } from './use-workspace-permissions'

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
 * This version accepts workspace permissions to avoid duplicate API calls
 *
 * @param workspacePermissions - The workspace permissions data
 * @param permissionsLoading - Whether permissions are currently loading
 * @param permissionsError - Any error from fetching permissions
 * @returns Object containing permission flags and utility properties
 */
export function useUserPermissions(
  workspacePermissions: WorkspacePermissions | null,
  permissionsLoading = false,
  permissionsError: string | null = null
): WorkspaceUserPermissions {
  const { data: session } = useSession()

  const userPermissions = useMemo((): WorkspaceUserPermissions => {
    // If still loading or no session, return safe defaults
    if (permissionsLoading || !session?.user?.email) {
      return {
        canRead: false,
        canEdit: false,
        canAdmin: false,
        userPermissions: 'read',
        isLoading: permissionsLoading,
        error: permissionsError,
      }
    }

    // Find current user in workspace permissions (case-insensitive)
    const currentUser = workspacePermissions?.users?.find(
      (user) => user.email.toLowerCase() === session.user.email.toLowerCase()
    )

    // If user not found in workspace, they have no permissions
    if (!currentUser) {
      logger.warn('User not found in workspace permissions', {
        userEmail: session.user.email,
        hasPermissions: !!workspacePermissions,
        userCount: workspacePermissions?.users?.length || 0,
      })

      return {
        canRead: false,
        canEdit: false,
        canAdmin: false,
        userPermissions: 'read',
        isLoading: false,
        error: permissionsError || 'User not found in workspace',
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
      error: permissionsError,
    }
  }, [session, workspacePermissions, permissionsLoading, permissionsError])

  return userPermissions
}
