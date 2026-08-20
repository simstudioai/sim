import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { workflow } from '../../db/schema'
import { createLogger } from '../../lib/logs/console-logger'
import { getUserEntityPermissions } from '../../lib/permissions/utils'

const logger = createLogger('SocketPermissions')

export async function verifyWorkspaceMembership(
  userId: string,
  workspaceId: string
): Promise<string | null> {
  try {
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    return permission
  } catch (error) {
    logger.error(`Error verifying workspace permissions for ${userId} in ${workspaceId}:`, error)
    return null
  }
}

export async function verifyWorkflowAccess(
  userId: string,
  workflowId: string
): Promise<{ hasAccess: boolean; role?: string; workspaceId?: string }> {
  try {
    const workflowData = await db
      .select({
        userId: workflow.userId,
        workspaceId: workflow.workspaceId,
        name: workflow.name,
      })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowData.length) {
      logger.warn(`Workflow ${workflowId} not found`)
      return { hasAccess: false }
    }

    const { userId: workflowUserId, workspaceId, name: workflowName } = workflowData[0]

    // Check if user owns the workflow
    if (workflowUserId === userId) {
      logger.debug(`User ${userId} has owner access to workflow ${workflowId} (${workflowName})`)
      return { hasAccess: true, role: 'owner', workspaceId: workspaceId || undefined }
    }

    // Check workspace membership if workflow belongs to a workspace
    if (workspaceId) {
      const userRole = await verifyWorkspaceMembership(userId, workspaceId)
      if (userRole) {
        logger.debug(
          `User ${userId} has ${userRole} access to workflow ${workflowId} via workspace ${workspaceId}`
        )
        return { hasAccess: true, role: userRole, workspaceId }
      }
      logger.warn(
        `User ${userId} is not a member of workspace ${workspaceId} for workflow ${workflowId}`
      )
      return { hasAccess: false }
    }

    // Workflow doesn't belong to a workspace and user doesn't own it
    logger.warn(`User ${userId} has no access to workflow ${workflowId} (no workspace, not owner)`)
    return { hasAccess: false }
  } catch (error) {
    logger.error(
      `Error verifying workflow access for user ${userId}, workflow ${workflowId}:`,
      error
    )
    return { hasAccess: false }
  }
}

// Enhanced authorization for specific operations
export async function verifyOperationPermission(
  userId: string,
  workflowId: string,
  operation: string,
  target: string
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const accessInfo = await verifyWorkflowAccess(userId, workflowId)

    if (!accessInfo.hasAccess) {
      return { allowed: false, reason: 'No access to workflow' }
    }

    // Define operation permissions based on role
    const rolePermissions = {
      owner: [
        'add',
        'remove',
        'update',
        'update-position',
        'update-name',
        'toggle-enabled',
        'update-parent',
        'update-wide',
        'update-advanced-mode',
        'toggle-handles',
        'duplicate',
      ],
      admin: [
        'add',
        'remove',
        'update',
        'update-position',
        'update-name',
        'toggle-enabled',
        'update-parent',
        'update-wide',
        'update-advanced-mode',
        'toggle-handles',
        'duplicate',
      ],
      member: [
        'add',
        'remove',
        'update',
        'update-position',
        'update-name',
        'toggle-enabled',
        'update-parent',
        'update-wide',
        'update-advanced-mode',
        'toggle-handles',
        'duplicate',
      ],
      viewer: ['update-position'], // Viewers can only move things around
    }

    const allowedOperations = rolePermissions[accessInfo.role as keyof typeof rolePermissions] || []

    if (!allowedOperations.includes(operation)) {
      return {
        allowed: false,
        reason: `Role '${accessInfo.role}' not permitted to perform '${operation}' on '${target}'`,
      }
    }

    return { allowed: true }
  } catch (error) {
    logger.error(`Error verifying operation permission:`, error)
    return { allowed: false, reason: 'Permission check failed' }
  }
}
