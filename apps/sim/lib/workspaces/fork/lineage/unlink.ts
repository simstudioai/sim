import { db } from '@sim/db'
import {
  workspace,
  workspaceForkBlockMap,
  workspaceForkDependentValue,
  workspaceForkPromoteRun,
  workspaceForkResourceMap,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import {
  acquireForkEdgeLock,
  type ForkEdge,
  setForkLockTimeout,
} from '@/lib/workspaces/fork/lineage/lineage'

const logger = createLogger('ForkUnlink')

export interface UnlinkForkResult {
  /** False when the edge was already dissolved by a concurrent unlink (idempotent no-op). */
  unlinked: boolean
}

/**
 * Permanently dissolve a fork edge: null the child's `forkedFromWorkspaceId` (the
 * edge's single source of truth) and purge the edge's fork state — resource map,
 * block map, dependent values, and promote-run undo points. Both workspaces are
 * left untouched; only the association and its metadata are removed.
 *
 * Runs in one transaction under the edge advisory lock, which every promote and
 * rollback on the edge also holds, so an in-flight sync either finishes before the
 * unlink or re-resolves the edge afterwards and fails with "not a direct fork edge".
 * The edge is re-verified inside the lock; a concurrently-dissolved edge is an
 * idempotent success rather than an error.
 */
export async function unlinkForkEdge(
  edge: ForkEdge,
  requestId?: string
): Promise<UnlinkForkResult> {
  const { childWorkspaceId, parentWorkspaceId } = edge

  const unlinked = await db.transaction(async (tx) => {
    await setForkLockTimeout(tx)
    await acquireForkEdgeLock(tx, childWorkspaceId)

    const updated = await tx
      .update(workspace)
      .set({ forkedFromWorkspaceId: null, updatedAt: new Date() })
      .where(
        and(
          eq(workspace.id, childWorkspaceId),
          eq(workspace.forkedFromWorkspaceId, parentWorkspaceId)
        )
      )
      .returning({ id: workspace.id })
    if (updated.length === 0) return false

    await tx
      .delete(workspaceForkResourceMap)
      .where(eq(workspaceForkResourceMap.childWorkspaceId, childWorkspaceId))
    await tx
      .delete(workspaceForkBlockMap)
      .where(eq(workspaceForkBlockMap.childWorkspaceId, childWorkspaceId))
    await tx
      .delete(workspaceForkDependentValue)
      .where(eq(workspaceForkDependentValue.childWorkspaceId, childWorkspaceId))
    await tx
      .delete(workspaceForkPromoteRun)
      .where(eq(workspaceForkPromoteRun.childWorkspaceId, childWorkspaceId))
    return true
  })

  logger.info(`[${requestId ?? 'unlink'}] Fork edge ${unlinked ? 'dissolved' : 'already gone'}`, {
    childWorkspaceId,
    parentWorkspaceId,
  })
  return { unlinked }
}
