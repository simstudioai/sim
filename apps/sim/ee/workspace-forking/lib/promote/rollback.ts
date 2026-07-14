import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, inArray, isNull } from 'drizzle-orm'
import {
  enqueueWorkflowUndeploySideEffects,
  processWorkflowDeploymentOutboxEvent,
} from '@/lib/workflows/deployment-outbox'
import { undeployWorkflow } from '@/lib/workflows/persistence/utils'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'
import {
  acquireForkEdgeLock,
  acquireForkTargetLock,
  resolveForkEdge,
  setForkLockTimeout,
} from '@/ee/workspace-forking/lib/lineage/lineage'
import { deleteWorkflowIdentityByIds } from '@/ee/workspace-forking/lib/mapping/mapping-store'
import {
  deleteAllPromoteRunsForTarget,
  getLatestPromoteRunForTarget,
} from '@/ee/workspace-forking/lib/promote/promote-run-store'
import { reactivateDeployedVersionInTx } from '@/ee/workspace-forking/lib/promote/reactivate-in-tx'
import { notifyForkWorkflowChanged } from '@/ee/workspace-forking/lib/socket'

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
  /** Snapshot workflows that no longer exist and so couldn't be restored. */
  skipped: number
  /** Ids of the skipped workflows (surfaced so the partial restore is never silent). */
  skippedIds: string[]
}

/** A single restore action, sorted by workflow id for a deterministic lock order. */
type RollbackOp =
  | { workflowId: string; kind: 'reactivate'; version: number }
  | { workflowId: string; kind: 'undeploy' }

/**
 * Undo the most recent promote into `targetWorkspaceId` in ONE atomic, fork-locked,
 * DB-only transaction. Because a concurrent promote takes the same target advisory
 * lock for its write transaction, it cannot interleave with the rollback: it runs
 * fully before or fully after. If a newer sync superseded our undo point, we abort
 * with 409 BEFORE any write, so the operation is strictly all-or-nothing - it never
 * leaves a partially reverted target.
 *
 * The heavy webhook / schedule / MCP re-subscription work is enqueued to the
 * deployment outbox INSIDE the transaction and processed AFTER commit (and durably
 * retried by the outbox cron/reaper if this process dies first), so the locked
 * transaction never holds across a network call. No draft blobs are stored - the
 * deployed version is the source of truth.
 */
export async function rollbackFork(params: RollbackForkParams): Promise<RollbackForkResult> {
  const { targetWorkspaceId, otherWorkspaceId, userId } = params
  const requestId = params.requestId ?? 'unknown'

  const edge = await resolveForkEdge(targetWorkspaceId, otherWorkspaceId)
  if (!edge) {
    throw new ForkError('These workspaces are not a direct fork edge', 400)
  }

  // Only the most recent sync into the target is undoable. Undoing an older sibling's
  // sync while a newer one stands would partially revert the target and strand the
  // newer sync's changes.
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

  // Build the restore ops: reactivate a prior version, or undeploy (created targets +
  // updated targets that had no prior deployment). Sort by workflow id so the locked
  // transaction acquires workflow row locks in a deterministic order, avoiding
  // deadlocks with the (unlocked) promote deploy loop, which locks the same rows.
  const undeployIds = [
    ...created,
    ...updated.filter((i) => i.priorVersion == null).map((i) => i.workflowId),
  ]
  const toReactivateOps = (
    list: Array<{ workflowId: string; priorVersion: number | null }>
  ): RollbackOp[] =>
    list
      .filter((item) => item.priorVersion != null)
      .map((item) => ({
        workflowId: item.workflowId,
        kind: 'reactivate' as const,
        version: item.priorVersion as number,
      }))
  const ops: RollbackOp[] = [
    ...toReactivateOps(updated),
    ...toReactivateOps(archived),
    ...undeployIds.map((workflowId) => ({ workflowId, kind: 'undeploy' as const })),
  ].sort((a, b) => a.workflowId.localeCompare(b.workflowId))

  const skipped = new Set<string>()
  const outboxEventIds: string[] = []

  await db.transaction(async (tx) => {
    await setForkLockTimeout(tx)
    await acquireForkTargetLock(tx, targetWorkspaceId)
    await acquireForkEdgeLock(tx, edge.childWorkspaceId)

    // Re-confirm our run is still the newest sync, now under the lock. If a promote
    // landed since the unlocked read above, abort with NO writes (tx rolls back).
    const current = await getLatestPromoteRunForTarget(tx, targetWorkspaceId)
    if (!current || current.id !== run.id) {
      throw new ForkError(
        'A newer sync into this workspace exists; reopen and undo the most recent sync.',
        409
      )
    }

    const now = new Date()

    // Un-archive the orphans the promote archived BEFORE reactivating them.
    if (archived.length > 0) {
      await tx
        .update(workflow)
        .set({ archivedAt: null, updatedAt: now })
        .where(
          inArray(
            workflow.id,
            archived.map((i) => i.workflowId)
          )
        )
    }

    // Which undeploy targets still exist (created targets can be hard-deleted after the
    // promote; a missing one is already gone, so skip rather than fail the rollback).
    const existingUndeploy =
      undeployIds.length === 0
        ? new Set<string>()
        : new Set(
            (
              await tx
                .select({ id: workflow.id })
                .from(workflow)
                .where(inArray(workflow.id, undeployIds))
            ).map((row) => row.id)
          )

    for (const op of ops) {
      if (op.kind === 'reactivate') {
        const result = await reactivateDeployedVersionInTx({
          tx,
          workflowId: op.workflowId,
          version: op.version,
          userId,
          requestId,
        })
        // A null result means the workflow / version was hard-deleted since the
        // promote - record it so the partial restore is surfaced, never silent.
        if (!result) {
          skipped.add(op.workflowId)
          continue
        }
        if (result.outboxEventId) outboxEventIds.push(result.outboxEventId)
        continue
      }

      if (!existingUndeploy.has(op.workflowId)) {
        skipped.add(op.workflowId)
        continue
      }
      const undeployResult = await undeployWorkflow({
        workflowId: op.workflowId,
        tx,
        onUndeployTransaction: async (innerTx, { deploymentVersionIds }) => {
          if (deploymentVersionIds.length === 0) return
          const eventId = await enqueueWorkflowUndeploySideEffects(innerTx, {
            workflowId: op.workflowId,
            deploymentVersionIds,
            userId,
            requestId,
          })
          outboxEventIds.push(eventId)
        },
      })
      if (!undeployResult.success) {
        // The workflow exists but couldn't be undeployed - abort so we never leave a
        // partial undo. The whole tx rolls back and the undo point is preserved.
        throw new ForkError(
          `Rollback could not undeploy workflow ${op.workflowId}: ${undeployResult.error ?? 'unknown error'}. The undo point is preserved - retry the rollback.`,
          500
        )
      }
    }

    // Archive the workflows the promote created and dissolve their identity rows.
    if (created.length > 0) {
      await tx
        .update(workflow)
        .set({ archivedAt: now, updatedAt: now })
        .where(inArray(workflow.id, created))
      // Archive their chat deployments too (matching `archiveWorkflow`): the sync carried a
      // chat onto each created target, and leaving it live would keep a working chat URL (with
      // the copied auth config) pointing at the archived workflow. The undeploy above already
      // cleans webhooks + MCP tools via the outbox; chats have no undeploy hook.
      await tx
        .update(chat)
        .set({ archivedAt: now, isActive: false, updatedAt: now })
        .where(and(inArray(chat.workflowId, created), isNull(chat.archivedAt)))
      // A created target is the child side on pull and the parent side on push.
      await deleteWorkflowIdentityByIds(
        tx,
        edge.childWorkspaceId,
        run.direction === 'pull' ? 'child' : 'parent',
        created
      )
    }

    // Single-level undo: drop every undo point for this target so no older sibling
    // sync becomes undoable once this one is undone.
    await deleteAllPromoteRunsForTarget(tx, targetWorkspaceId)
  })

  // After commit: process the enqueued side-effects (webhooks / schedules / MCP). These
  // are durable outbox rows, so a crash here is recovered by the outbox cron/reaper -
  // failures only warn, they never undo the (committed) restore.
  for (const eventId of outboxEventIds) {
    try {
      await processWorkflowDeploymentOutboxEvent(eventId)
    } catch (error) {
      logger.warn(
        `[${requestId}] Deferred rollback side-effect processing failed (will retry via outbox)`,
        { eventId, error }
      )
    }
  }

  if (skipped.size > 0) {
    logger.warn(
      `[${requestId}] Rollback skipped ${skipped.size} workflow(s) no longer in the database`,
      {
        targetWorkspaceId,
        skipped: Array.from(skipped),
      }
    )
  }

  // Notify connected canvases to adopt the restored state (reactivated drafts + the
  // undeployed/archived created targets). Skipped (gone) workflows have no room.
  const notifyIds = new Set<string>()
  for (const op of ops) {
    if (!skipped.has(op.workflowId)) notifyIds.add(op.workflowId)
  }
  for (const workflowId of notifyIds) void notifyForkWorkflowChanged(workflowId)

  // Attribute each skip to its bucket (a workflow is in exactly one) so the counts
  // reflect what was actually restored, not the snapshot size.
  const createdSet = new Set(created)
  const archivedSet = new Set(archived.map((i) => i.workflowId))
  const updatedSet = new Set(updated.map((i) => i.workflowId))
  let skippedUpdated = 0
  let skippedCreated = 0
  let skippedArchived = 0
  for (const id of skipped) {
    if (updatedSet.has(id)) skippedUpdated += 1
    else if (createdSet.has(id)) skippedCreated += 1
    else if (archivedSet.has(id)) skippedArchived += 1
  }

  const restored = updated.length - skippedUpdated
  const archivedCount = created.length - skippedCreated
  const unarchived = archived.length - skippedArchived

  const result: RollbackForkResult = {
    restored,
    archived: archivedCount,
    unarchived,
    skipped: skipped.size,
    skippedIds: Array.from(skipped),
  }

  logger.info(`[${requestId}] Rolled back promote into ${targetWorkspaceId}`, {
    restored: result.restored,
    archived: result.archived,
    unarchived: result.unarchived,
    skipped: result.skipped,
  })

  return result
}
