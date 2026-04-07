import { createLogger } from '@sim/logger'
import { getActiveWorkflowContext } from '@/lib/workflows/active-context'
import { getUserEntityPermissions, type PermissionType } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CopilotPermissions')

/**
 * Verifies if a user has access to a workflow for copilot operations
 *
 * @param userId - The authenticated user ID
 * @param workflowId - The workflow ID to check access for
 * @returns Promise<{ hasAccess: boolean; userPermission: PermissionType | null; workspaceId?: string }>
 */
export async function verifyWorkflowAccess(
  userId: string,
  workflowId: string
): Promise<{
  hasAccess: boolean
  userPermission: PermissionType | null
  workspaceId?: string
}> {
  try {
    const workflowContext = await getActiveWorkflowContext(workflowId)
    if (!workflowContext) {
      logger.warn('Attempt to access non-existent workflow', {
        workflowId,
        userId,
      })
      return { hasAccess: false, userPermission: null }
    }

    const { workspaceId } = workflowContext

    const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)

    if (userPermission !== null) {
      logger.debug('User has workspace permission for workflow', {
        workflowId,
        userId,
        workspaceId,
        userPermission,
      })
      return {
        hasAccess: true,
        userPermission,
        workspaceId,
      }
    }

    logger.warn('User has no access to workflow', {
      workflowId,
      userId,
      workspaceId,
    })
    return {
      hasAccess: false,
      userPermission: null,
      workspaceId: workspaceId || undefined,
    }
  } catch (error) {
    logger.error('Error verifying workflow access', { error, workflowId, userId })
    return { hasAccess: false, userPermission: null }
  }
}

/**
 * Helper function to create consistent permission error messages
 */
export function createPermissionError(operation: string): string {
  return `Access denied: You do not have permission to ${operation} this workflow`
}
