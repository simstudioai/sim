import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions, type PermissionType } from '@/lib/permissions/utils'

const logger = createLogger('CopilotPermissions')

/**
 * Verifies if a user has access to a workflow for copilot operations
 *
 * @param userId - The authenticated user ID
 * @param workflowId - The workflow ID to check access for
 * @returns Promise<{ hasAccess: boolean; userPermission: PermissionType | null; workspaceId?: string; isOwner: boolean }>
 */
export async function verifyWorkflowAccess(
  userId: string,
  workflowId: string
): Promise<{
  hasAccess: boolean
  userPermission: PermissionType | null
  workspaceId?: string
  isOwner: boolean
}> {
  try {
    const workflowData = await db
      .select({
        userId: workflow.userId,
        workspaceId: workflow.workspaceId,
      })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowData.length) {
      logger.warn('Attempt to access non-existent workflow', {
        workflowId,
        userId,
      })
      return { hasAccess: false, userPermission: null, isOwner: false }
    }

    const { userId: workflowOwnerId, workspaceId } = workflowData[0]

    if (workflowOwnerId === userId) {
      logger.debug('User has direct ownership of workflow', { workflowId, userId })
      return {
        hasAccess: true,
        userPermission: 'admin',
        workspaceId: workspaceId || undefined,
        isOwner: true,
      }
    }

    if (workspaceId && userId) {
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
          workspaceId: workspaceId || undefined,
          isOwner: false,
        }
      }
    }

    logger.warn('User has no access to workflow', {
      workflowId,
      userId,
      workspaceId,
      workflowOwnerId,
    })
    return {
      hasAccess: false,
      userPermission: null,
      workspaceId: workspaceId || undefined,
      isOwner: false,
    }
  } catch (error) {
    logger.error('Error verifying workflow access', { error, workflowId, userId })
    return { hasAccess: false, userPermission: null, isOwner: false }
  }
}

/**
 * Helper function to create consistent permission error messages
 */
export function createPermissionError(operation: string): string {
  return `Access denied: You do not have permission to ${operation} this workflow`
}
