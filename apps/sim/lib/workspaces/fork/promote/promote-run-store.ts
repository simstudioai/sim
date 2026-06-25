import { workspaceForkPromoteRun } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, desc, eq } from 'drizzle-orm'
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

/** The promote undo point for an edge in one direction (keyed by its target), or null. */
export async function getPromoteRunForEdge(
  executor: DbOrTx,
  childWorkspaceId: string,
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
    .where(
      and(
        eq(workspaceForkPromoteRun.childWorkspaceId, childWorkspaceId),
        eq(workspaceForkPromoteRun.targetWorkspaceId, targetWorkspaceId)
      )
    )
    .limit(1)
  if (!row) return null
  return { ...row, snapshot: row.snapshot as PromoteRunSnapshot }
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

/** Remove one direction's undo point (keyed by target) after a successful rollback. */
export async function deletePromoteRun(
  tx: DbOrTx,
  childWorkspaceId: string,
  targetWorkspaceId: string
): Promise<void> {
  await tx
    .delete(workspaceForkPromoteRun)
    .where(
      and(
        eq(workspaceForkPromoteRun.childWorkspaceId, childWorkspaceId),
        eq(workspaceForkPromoteRun.targetWorkspaceId, targetWorkspaceId)
      )
    )
}

/**
 * The undo point targeting this workspace, with the edge counterpart needed to
 * call rollback. `sourceWorkspaceId` is the "other" workspace the promote came
 * from (rollback resolves the edge from target + other).
 */
export async function getUndoableRunForTarget(
  executor: DbOrTx,
  targetWorkspaceId: string
): Promise<{ sourceWorkspaceId: string; direction: 'push' | 'pull' } | null> {
  const [row] = await executor
    .select({
      sourceWorkspaceId: workspaceForkPromoteRun.sourceWorkspaceId,
      direction: workspaceForkPromoteRun.direction,
    })
    .from(workspaceForkPromoteRun)
    .where(eq(workspaceForkPromoteRun.targetWorkspaceId, targetWorkspaceId))
    // A workspace can be the target of several edges; surface the most recent.
    .orderBy(desc(workspaceForkPromoteRun.createdAt))
    .limit(1)
  return row ?? null
}

/** The undo point whose target is this workspace and whose edge counterpart is `otherWorkspaceId`. */
export async function getPromoteRunForRollback(
  executor: DbOrTx,
  targetWorkspaceId: string,
  childWorkspaceId: string
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
    .where(
      and(
        eq(workspaceForkPromoteRun.childWorkspaceId, childWorkspaceId),
        eq(workspaceForkPromoteRun.targetWorkspaceId, targetWorkspaceId)
      )
    )
    .limit(1)
  if (!row) return null
  return { ...row, snapshot: row.snapshot as PromoteRunSnapshot }
}
