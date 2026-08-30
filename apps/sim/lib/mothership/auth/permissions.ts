import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import type { PermissionType } from '@/lib/workspaces/permissions/utils'

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
    const result = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId,
      action: 'read',
    })
    return {
      hasAccess: result.allowed,
      userPermission: result.workspacePermission,
      workspaceId: result.workflow?.workspaceId ?? undefined,
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
