import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { verifyWorkflowAccess } from '@/middleware/permissions'
import type { IRoomManager } from '@/rooms/types'

const logger = createLogger('RoomAccess')

/**
 * Reconciles active realtime rooms with a user's current workspace permission.
 *
 * For every non-archived workflow in the workspace that has an active room
 * containing the user, the user's access is re-verified against the live
 * `permissions` table:
 * - If access was fully revoked, every one of the user's sockets is evicted from
 *   the room (works cross-pod via the Redis adapter) so they immediately stop
 *   receiving and persisting edits.
 * - If access was merely downgraded, the cached role is refreshed in place so
 *   subsequent operations are authorized against the new role without waiting for
 *   the per-presence revalidation TTL to elapse.
 */
export async function reconcileWorkspaceAccessChange(
  manager: IRoomManager,
  workspaceId: string,
  userId: string
): Promise<void> {
  let workflows: { id: string }[]
  try {
    workflows = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
  } catch (error) {
    logger.error(`Failed to load workflows for workspace ${workspaceId} access change`, error)
    return
  }

  for (const { id: workflowId } of workflows) {
    try {
      const hasRoom = await manager.hasWorkflowRoom(workflowId)
      if (!hasRoom) continue

      const users = await manager.getWorkflowUsers(workflowId)
      const targets = users.filter((u) => u.userId === userId)
      if (targets.length === 0) continue

      const access = await verifyWorkflowAccess(userId, workflowId)

      if (access.hasAccess) {
        const role = access.role || 'read'
        for (const target of targets) {
          await manager.updateUserRole(workflowId, target.socketId, role)
        }
        await manager.broadcastPresenceUpdate(workflowId)
        logger.info(
          `Refreshed cached role to '${role}' for user ${userId} on workflow ${workflowId}`
        )
        continue
      }

      for (const target of targets) {
        manager.io.to(target.socketId).emit('workflow-permissions-revoked', {
          workflowId,
          message: 'Your access to this workflow has been revoked',
          timestamp: Date.now(),
        })
        await manager.removeUserFromRoom(target.socketId, workflowId)
        await manager.io.in(target.socketId).socketsLeave(workflowId)
      }
      await manager.broadcastPresenceUpdate(workflowId)
      logger.info(
        `Evicted ${targets.length} socket(s) for revoked user ${userId} from workflow ${workflowId}`
      )
    } catch (error) {
      logger.error(`Failed to reconcile access for user ${userId} on workflow ${workflowId}`, error)
    }
  }
}
