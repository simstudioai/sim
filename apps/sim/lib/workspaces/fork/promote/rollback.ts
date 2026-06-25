import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { inArray } from 'drizzle-orm'
import {
  performActivateVersion,
  performRevertToVersion,
} from '@/lib/workflows/orchestration/deploy'
import { undeployWorkflow } from '@/lib/workflows/persistence/utils'
import { ForkError } from '@/lib/workspaces/fork/lineage/authz'
import {
  acquireForkEdgeLock,
  acquireForkTargetLock,
  resolveForkEdge,
} from '@/lib/workspaces/fork/lineage/lineage'
import { deleteWorkflowIdentityByIds } from '@/lib/workspaces/fork/mapping/mapping-store'
import {
  deleteAllPromoteRunsForTarget,
  getLatestPromoteRunForTarget,
} from '@/lib/workspaces/fork/promote/promote-run-store'
import { notifyForkWorkflowChanged } from '@/lib/workspaces/fork/socket'

const logger = createLogger('WorkspaceForkRollback')

export interface RollbackForkParams {
  targetWorkspaceId: string
  otherWorkspaceId: string
  userId: string
  requestId?: string
}

export interface RollbackForkResult {
  restored: number
  archived: number
  unarchived: number
  /** Snapshot workflows that no longer exist and so couldn't be reactivated. */
  skipped: number
}

// A type alias (not interface) so it satisfies the `Record<string, unknown>`
// param of performActivateVersion/performRevertToVersion. workspaceId is nullable
// to match the workflow table column.
type WorkflowRecord = {
  id: string
  workspaceId: string | null
  name: string
}

/**
 * Undo the most recent promote into `targetWorkspaceId`. Ordering is durability-
 * sensitive: prior deployed versions are reactivated (and loaded back into the
 * draft) FIRST; only once every reactivation succeeds do we undeploy/archive the
 * workflows the promote created, dissolve the identity rows it created, and delete
 * the undo point. A reactivation failure throws with the undo point intact, so the
 * rollback is retryable (every step is idempotent). No draft blobs are stored -
 * the deployed version is the source of truth.
 */
export async function rollbackFork(params: RollbackForkParams): Promise<RollbackForkResult> {
  const { targetWorkspaceId, otherWorkspaceId, userId } = params
  const requestId = params.requestId ?? 'unknown'

  const edge = await resolveForkEdge(targetWorkspaceId, otherWorkspaceId)
  if (!edge) {
    throw new ForkError('These workspaces are not a direct fork edge', 400)
  }

  // Only the most recent sync into the target is undoable. Undoing an older
  // sibling's sync while a newer one stands would partially revert the target and
  // strand the newer sync's changes (and its now-stale undo point).
  const run = await getLatestPromoteRunForTarget(db, targetWorkspaceId)
  if (!run) {
    throw new ForkError('There is no promote to undo for this workspace', 404)
  }
  if (run.childWorkspaceId !== edge.childWorkspaceId) {
    throw new ForkError(
      'A newer sync into this workspace exists; reopen and undo the most recent sync.',
      409
    )
  }

  const { updated, created, archived } = run.snapshot

  const reactivate: Array<{ workflowId: string; version: number }> = []
  const undeployIds = new Set<string>()
  for (const item of updated) {
    if (item.priorVersion != null)
      reactivate.push({ workflowId: item.workflowId, version: item.priorVersion })
    else undeployIds.add(item.workflowId)
  }
  for (const item of archived) {
    if (item.priorVersion != null)
      reactivate.push({ workflowId: item.workflowId, version: item.priorVersion })
  }
  for (const workflowId of created) undeployIds.add(workflowId)

  const reactivateIds = reactivate.map((r) => r.workflowId)
  const records = new Map<string, WorkflowRecord>()
  if (reactivateIds.length > 0) {
    const rows = await db
      .select({ id: workflow.id, workspaceId: workflow.workspaceId, name: workflow.name })
      .from(workflow)
      .where(inArray(workflow.id, reactivateIds))
    for (const row of rows) records.set(row.id, row)
  }

  // Un-archive the orphans the promote archived BEFORE reactivating them.
  if (archived.length > 0) {
    await db.transaction(async (tx) => {
      await acquireForkTargetLock(tx, targetWorkspaceId)
      await acquireForkEdgeLock(tx, edge.childWorkspaceId)
      await tx
        .update(workflow)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(
          inArray(
            workflow.id,
            archived.map((i) => i.workflowId)
          )
        )
    })
  }

  // Reactivate prior versions + restore drafts. Any failure aborts with the undo
  // point intact so the operation can be retried.
  const skipped: string[] = []
  for (const { workflowId, version } of reactivate) {
    const record = records.get(workflowId)
    if (!record) {
      // The target was hard-deleted since the promote, so it can't be reactivated.
      // Skipping (vs throwing) is deliberate: a throw here would wedge the undo
      // point forever since the workflow never reappears. We record it so the
      // partial restore is surfaced instead of silently over-reported.
      skipped.push(workflowId)
      continue
    }
    const activated = await performActivateVersion({
      workflowId,
      version,
      userId,
      workflow: record,
      requestId,
    })
    if (!activated.success) {
      throw new ForkError(
        `Rollback could not reactivate workflow ${workflowId} (v${version}): ${activated.error ?? 'unknown error'}. The undo point is preserved - retry the rollback.`,
        500
      )
    }
    const reverted = await performRevertToVersion({ workflowId, version, userId, workflow: record })
    if (!reverted.success) {
      throw new ForkError(
        `Rollback reactivated workflow ${workflowId} but could not restore its draft: ${reverted.error ?? 'unknown error'}. Retry the rollback.`,
        500
      )
    }
  }

  if (skipped.length > 0) {
    logger.warn(
      `[${requestId}] Rollback skipped ${skipped.length} workflow(s) no longer in the database`,
      { targetWorkspaceId, skipped }
    )
  }

  // Reactivation fully succeeded: remove the workflows the promote created,
  // dissolve the identity rows it created, and consume the undo point.
  await db.transaction(async (tx) => {
    await acquireForkTargetLock(tx, targetWorkspaceId)
    await acquireForkEdgeLock(tx, edge.childWorkspaceId)

    // Under the target lock, confirm our run is still the newest sync into the
    // target. A concurrent promote (same edge or a sibling) would make it stale;
    // abort so we never clean up against a newer sync's state.
    const current = await getLatestPromoteRunForTarget(tx, targetWorkspaceId)
    if (!current || current.id !== run.id) {
      throw new ForkError(
        'This undo was superseded by a newer sync into the target; reopen and retry.',
        409
      )
    }

    const now = new Date()

    for (const workflowId of undeployIds) {
      await undeployWorkflow({ workflowId, tx })
    }
    if (created.length > 0) {
      await tx
        .update(workflow)
        .set({ archivedAt: now, updatedAt: now })
        .where(inArray(workflow.id, created))
      // A created target is the child side on pull and the parent side on push.
      await deleteWorkflowIdentityByIds(
        tx,
        edge.childWorkspaceId,
        run.direction === 'pull' ? 'child' : 'parent',
        created
      )
    }

    // Single-level undo: drop every undo point for this target (not just ours) so
    // no older sibling sync becomes undoable once this one is undone.
    await deleteAllPromoteRunsForTarget(tx, targetWorkspaceId)
  })

  for (const workflowId of undeployIds) void notifyForkWorkflowChanged(workflowId)

  // Attribute skips to their bucket so the counts reflect what was actually
  // restored, not the snapshot size (a workflow is in exactly one of the two).
  const skippedSet = new Set(skipped)
  const skippedUpdated = updated.filter(
    (item) => item.priorVersion != null && skippedSet.has(item.workflowId)
  ).length
  const result: RollbackForkResult = {
    restored: updated.length - skippedUpdated,
    archived: created.length,
    unarchived: archived.length - (skipped.length - skippedUpdated),
    skipped: skipped.length,
  }

  logger.info(`[${requestId}] Rolled back promote into ${targetWorkspaceId}`, result)

  return result
}
