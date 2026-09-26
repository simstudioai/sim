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
  acquireForkLineageLock,
  type ForkEdge,
  setForkLockTimeout,
} from '@/ee/workspace-forking/lib/lineage/lineage'
import { resolveForkLineageRootId } from '@/ee/workspace-forking/lib/sync-default'

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
 * Runs in one transaction under the lineage and edge advisory locks. Every promote and
 * rollback on the edge holds the edge lock, so an in-flight sync either finishes before
 * the unlink or re-resolves the edge afterwards and fails with "not a direct fork edge";
 * the lineage lock additionally serializes against fork creation and the lineage-wide
 * fork-sync default write, which both key on the root this unlink is about to change.
 * The edge is re-verified inside the lock; a concurrently-dissolved edge is an
 * idempotent success rather than an error.
 */
export async function unlinkForkEdge(
  edge: ForkEdge,
  requestId?: string
): Promise<UnlinkForkResult> {
  const { childWorkspaceId, parentWorkspaceId } = edge

  // Resolved before the transaction: the walk is several round trips, and issuing them
  // from inside the tx would hold this connection while checking out more.
  const lineageRootId = await resolveForkLineageRootId(db, childWorkspaceId)

  const unlinked = await db.transaction(async (tx) => {
    await setForkLockTimeout(tx)
    // Severing this edge changes which lineage the child belongs to, and therefore which
    // key `setForkSyncDefault` and `createFork` lock on. Taking the lineage lock first
    // (the documented ordering) keeps an unlink from splitting a lineage underneath a
    // policy write that already enumerated its members.
    await acquireForkLineageLock(tx, lineageRootId)
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
