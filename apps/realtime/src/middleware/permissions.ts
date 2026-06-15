import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  BLOCK_OPERATIONS,
  BLOCKS_OPERATIONS,
  EDGE_OPERATIONS,
  EDGES_OPERATIONS,
  SUBBLOCK_OPERATIONS,
  SUBFLOW_OPERATIONS,
  VARIABLE_OPERATIONS,
  WORKFLOW_OPERATIONS,
} from '@sim/realtime-protocol/constants'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { and, eq, isNull } from 'drizzle-orm'
import type { IRoomManager, UserPresence } from '@/rooms/types'

const logger = createLogger('SocketPermissions')

/**
 * How long a cached role is trusted before it must be re-verified against the
 * live `permissions` table. Bounds the window in which a revoked or downgraded
 * collaborator can keep acting on a stale role on an already-connected socket.
 */
const ROLE_REVALIDATION_TTL_MS = 15_000

// Admin-only operations (require admin role)
const ADMIN_ONLY_OPERATIONS: string[] = [BLOCKS_OPERATIONS.BATCH_TOGGLE_LOCKED]

// Write operations (admin and write roles both have these permissions)
const WRITE_OPERATIONS: string[] = [
  // Block operations
  BLOCK_OPERATIONS.UPDATE_POSITION,
  BLOCK_OPERATIONS.UPDATE_NAME,
  BLOCK_OPERATIONS.TOGGLE_ENABLED,
  BLOCK_OPERATIONS.UPDATE_PARENT,
  BLOCK_OPERATIONS.UPDATE_ADVANCED_MODE,
  BLOCK_OPERATIONS.UPDATE_CANONICAL_MODE,
  BLOCK_OPERATIONS.TOGGLE_HANDLES,
  // Batch block operations
  BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS,
  BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS,
  BLOCKS_OPERATIONS.BATCH_REMOVE_BLOCKS,
  BLOCKS_OPERATIONS.BATCH_TOGGLE_ENABLED,
  BLOCKS_OPERATIONS.BATCH_TOGGLE_HANDLES,
  BLOCKS_OPERATIONS.BATCH_UPDATE_PARENT,
  // Edge operations
  EDGE_OPERATIONS.ADD,
  EDGE_OPERATIONS.REMOVE,
  // Batch edge operations
  EDGES_OPERATIONS.BATCH_ADD_EDGES,
  EDGES_OPERATIONS.BATCH_REMOVE_EDGES,
  // Subflow operations
  SUBFLOW_OPERATIONS.UPDATE,
  // Subblock operations
  SUBBLOCK_OPERATIONS.UPDATE,
  SUBBLOCK_OPERATIONS.BATCH_UPDATE,
  // Variable operations
  VARIABLE_OPERATIONS.UPDATE,
  // Workflow operations
  WORKFLOW_OPERATIONS.REPLACE_STATE,
]

// Read role can only update positions (for cursor sync, etc.)
const READ_OPERATIONS: string[] = [
  BLOCK_OPERATIONS.UPDATE_POSITION,
  BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS,
]

// Define operation permissions based on role
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [...ADMIN_ONLY_OPERATIONS, ...WRITE_OPERATIONS],
  write: WRITE_OPERATIONS,
  read: READ_OPERATIONS,
}

// Check if a role allows a specific operation (no DB query, pure logic)
export function checkRolePermission(
  role: string,
  operation: string
): { allowed: boolean; reason?: string } {
  const allowedOperations = ROLE_PERMISSIONS[role] || []

  if (!allowedOperations.includes(operation)) {
    return {
      allowed: false,
      reason: `Role '${role}' not permitted to perform '${operation}'`,
    }
  }

  return { allowed: true }
}

/**
 * Authorizes a mutating socket operation against the caller's *current* role.
 *
 * The role cached in presence is trusted only for `ROLE_REVALIDATION_TTL_MS`;
 * once stale it is re-verified against the live `permissions` table and the
 * refreshed role is written back to presence. This bounds how long a revoked or
 * downgraded collaborator can keep mutating a workflow on an already-connected
 * socket, complementing the push-based eviction triggered by the main app.
 *
 * Transient database failures during re-validation fall back to the last known
 * role (without refreshing the timestamp, so the next operation retries) rather
 * than locking out legitimate users during a blip.
 */
export async function authorizeSocketOperation(params: {
  roomManager: IRoomManager
  workflowId: string
  socketId: string
  userId: string
  presence: UserPresence
  operation: string
}): Promise<{ allowed: boolean; role: string; reason?: string; accessRevoked: boolean }> {
  const { roomManager, workflowId, socketId, userId, presence, operation } = params

  let role = presence.role
  const lastChecked = presence.roleCheckedAt ?? 0
  const isStale = Date.now() - lastChecked >= ROLE_REVALIDATION_TTL_MS

  if (isStale) {
    try {
      const access = await verifyWorkflowAccess(userId, workflowId)
      if (!access.hasAccess) {
        return {
          allowed: false,
          role,
          reason: 'Access to this workflow has been revoked',
          accessRevoked: true,
        }
      }
      role = access.role || 'read'
      await roomManager.updateUserRole(workflowId, socketId, role)
    } catch (error) {
      logger.warn(
        `Failed to re-validate role for user ${userId} on workflow ${workflowId}; reusing cached role`,
        error
      )
    }
  }

  const permissionCheck = checkRolePermission(role, operation)
  return {
    allowed: permissionCheck.allowed,
    role,
    reason: permissionCheck.reason,
    accessRevoked: false,
  }
}

/**
 * Verifies a user's access to a workflow via workspace permissions.
 *
 * Returns `hasAccess: false` only for genuine denials (workflow missing/archived
 * or no workspace permission). Transient failures (DB errors) are rethrown so the
 * caller can report them as retryable instead of a permanent access denial.
 */
export async function verifyWorkflowAccess(
  userId: string,
  workflowId: string
): Promise<{ hasAccess: boolean; role?: string; workspaceId?: string }> {
  try {
    const workflowData = await db
      .select({
        workspaceId: workflow.workspaceId,
        name: workflow.name,
      })
      .from(workflow)
      .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
      .limit(1)

    if (!workflowData.length) {
      logger.warn(`Workflow ${workflowId} not found`)
      return { hasAccess: false }
    }

    const { workspaceId, name: workflowName } = workflowData[0]
    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId,
      action: 'read',
    })

    if (!authorization.allowed || !authorization.workspacePermission) {
      logger.warn(
        `User ${userId} is not permitted to access workflow ${workflowId}: ${authorization.message}`
      )
      return { hasAccess: false }
    }

    logger.debug(
      `User ${userId} has ${authorization.workspacePermission} access to workflow ${workflowId} (${workflowName}) via workspace ${workspaceId}`
    )
    return {
      hasAccess: true,
      role: authorization.workspacePermission,
      workspaceId: workspaceId || undefined,
    }
  } catch (error) {
    logger.error(
      `Error verifying workflow access for user ${userId}, workflow ${workflowId}:`,
      error
    )
    throw error
  }
}
