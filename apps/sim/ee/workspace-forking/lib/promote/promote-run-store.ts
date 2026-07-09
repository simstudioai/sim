import { workspaceForkPromoteRun } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { desc, eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/**
 * A target workflow's pre-promote deployed-version reference. Rollback reactivates
 * `priorVersion` (and loads it into the draft); `null` means the target was not
 * deployed before the promote, so rollback undeploys it instead.
 */
export interface PromoteRunWorkflowSnapshot {
  workflowId: string
  priorVersion: number | null
}

export interface PromoteRunSnapshot {
  /** Replaced targets: reactivate their prior deployed version on rollback. */
  updated: PromoteRunWorkflowSnapshot[]
  /** Targets the promote created: undeploy + archive on rollback. */
  created: string[]
  /** Orphan targets the promote archived: un-archive + reactivate on rollback. */
  archived: PromoteRunWorkflowSnapshot[]
}

export interface PromoteRunRow {
  id: string
  childWorkspaceId: string
  sourceWorkspaceId: string
  targetWorkspaceId: string
  direction: 'push' | 'pull'
  snapshot: PromoteRunSnapshot
  createdAt: Date
}

/** Replace the edge's undo point with a new run (single-level history). */
export async function upsertPromoteRun(
  tx: DbOrTx,
  params: {
    childWorkspaceId: string
    sourceWorkspaceId: string
    targetWorkspaceId: string
    direction: 'push' | 'pull'
    snapshot: PromoteRunSnapshot
    userId: string
  }
): Promise<string> {
  const now = new Date()
  const id = generateId()
  await tx
    .insert(workspaceForkPromoteRun)
    .values({
      id,
      childWorkspaceId: params.childWorkspaceId,
      sourceWorkspaceId: params.sourceWorkspaceId,
      targetWorkspaceId: params.targetWorkspaceId,
      direction: params.direction,
      snapshot: params.snapshot,
      createdBy: params.userId,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [workspaceForkPromoteRun.childWorkspaceId, workspaceForkPromoteRun.targetWorkspaceId],
      set: {
        id,
        sourceWorkspaceId: params.sourceWorkspaceId,
        direction: params.direction,
        snapshot: params.snapshot,
        createdBy: params.userId,
        createdAt: now,
      },
    })
  return id
}

/**
 * Remove EVERY undo point targeting this workspace. Called after a rollback so the
 * undo is single-level: only the latest sync into a target is ever undoable, and
 * once it is undone there is no stack of older syncs to walk back into.
 */
export async function deleteAllPromoteRunsForTarget(
  tx: DbOrTx,
  targetWorkspaceId: string
): Promise<void> {
  await tx
    .delete(workspaceForkPromoteRun)
    .where(eq(workspaceForkPromoteRun.targetWorkspaceId, targetWorkspaceId))
}

/**
 * The newest undo point targeting this workspace. A workspace can be the target of
 * several edges (pushes from its children, a pull from its parent), so order by
 * recency: this is the ONLY undoable sync - older ones are stale the moment a newer
 * sync lands, and rollback refuses them.
 */
export async function getLatestPromoteRunForTarget(
  executor: DbOrTx,
  targetWorkspaceId: string
): Promise<PromoteRunRow | null> {
  const [row] = await executor
    .select({
      id: workspaceForkPromoteRun.id,
      childWorkspaceId: workspaceForkPromoteRun.childWorkspaceId,
      sourceWorkspaceId: workspaceForkPromoteRun.sourceWorkspaceId,
      targetWorkspaceId: workspaceForkPromoteRun.targetWorkspaceId,
      direction: workspaceForkPromoteRun.direction,
      snapshot: workspaceForkPromoteRun.snapshot,
      createdAt: workspaceForkPromoteRun.createdAt,
    })
    .from(workspaceForkPromoteRun)
    .where(eq(workspaceForkPromoteRun.targetWorkspaceId, targetWorkspaceId))
    .orderBy(desc(workspaceForkPromoteRun.createdAt))
    .limit(1)
  if (!row) return null
  return { ...row, snapshot: row.snapshot as PromoteRunSnapshot }
}

/**
 * The "other" workspace and direction of the latest sync into this target, for the
 * UI's undo affordance. `sourceWorkspaceId` is the workspace the sync came from
 * (rollback resolves the edge from target + other).
 */
export async function getUndoableRunForTarget(
  executor: DbOrTx,
  targetWorkspaceId: string
): Promise<{ sourceWorkspaceId: string; direction: 'push' | 'pull' } | null> {
  const run = await getLatestPromoteRunForTarget(executor, targetWorkspaceId)
  return run ? { sourceWorkspaceId: run.sourceWorkspaceId, direction: run.direction } : null
}
