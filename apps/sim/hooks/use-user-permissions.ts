import { useMemo } from 'react'
import { useSession } from '@/lib/auth-client'
import { useWorkspacePermissions, type PermissionType } from './use-workspace-permissions'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('useUserPermissions')

export interface WorkspaceUserPermissions {
  // Core permission checks
  canRead: boolean
  canEdit: boolean
  canDeploy: boolean
  canAdmin: boolean
  
  // Computed permission checks for specific features
  canInteractWithBlocks: boolean // Covers both clicking and dragging blocks
  canAutoLayout: boolean
  canDeleteWorkflow: boolean
  canDuplicateWorkflow: boolean
  canDeployApi: boolean
  
  // Utility properties
  isReadOnly: boolean
  hasAnyEditPermission: boolean
  userPermissions: PermissionType[]
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
        canDeploy: false,
        canAdmin: false,
        canInteractWithBlocks: false,
        canAutoLayout: false,
        canDeleteWorkflow: false,
        canDuplicateWorkflow: false,
        canDeployApi: false,
        isReadOnly: true,
        hasAnyEditPermission: false,
        userPermissions: [],
        isLoading: loading,
        error,
      }
    }

    // Find current user in workspace permissions
    const currentUser = permissions?.users?.find(
      (user) => user.email === session.user.email
    )

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
        canDeploy: false,
        canAdmin: false,
        canInteractWithBlocks: false,
        canAutoLayout: false,
        canDeleteWorkflow: false,
        canDuplicateWorkflow: false,
        canDeployApi: false,
        isReadOnly: true,
        hasAnyEditPermission: false,
        userPermissions: [],
        isLoading: false,
        error: error || 'User not found in workspace',
      }
    }

    const userPerms = currentUser.permissions || []

    // Core permission checks
    const canAdmin = userPerms.includes('admin')
    const canDeploy = userPerms.includes('deploy') || canAdmin
    const canEdit = userPerms.includes('edit') || canAdmin
    const canRead = true // If user is found in workspace permissions, they have read access

    // Computed permission checks for specific features
    const canInteractWithBlocks = canEdit // Only edit+ can click/drag blocks
    const canAutoLayout = canEdit // Only edit+ can use auto-layout
    const canDeleteWorkflow = canEdit // Only edit+ can delete workflows
    const canDuplicateWorkflow = canEdit // Only edit+ can duplicate workflows
    const canDeployApi = canDeploy // Only deploy+ can deploy as API

    // Utility properties
    const isReadOnly = !canEdit && !canDeploy && !canAdmin // Read-only if they don't have edit permissions
    const hasAnyEditPermission = canEdit || canDeploy || canAdmin

    return {
      canRead,
      canEdit,
      canDeploy,
      canAdmin,
      canInteractWithBlocks,
      canAutoLayout,
      canDeleteWorkflow,
      canDuplicateWorkflow,
      canDeployApi,
      isReadOnly,
      hasAnyEditPermission,
      userPermissions: userPerms,
      isLoading: false,
      error,
    }
  }, [session, permissions, loading, error, workspaceId])

  return userPermissions
} 