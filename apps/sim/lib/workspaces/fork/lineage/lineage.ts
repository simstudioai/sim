import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

export interface ForkLineageNode {
  id: string
  name: string
  organizationId: string | null
}

export interface ForkEdge {
  childWorkspaceId: string
  parentWorkspaceId: string
}

/**
 * The parent workspace id a fork was created from, or null when the workspace
 * is not a fork (or has been archived).
 */
export async function getForkParentId(workspaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ parentId: workspace.forkedFromWorkspaceId })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)
  return row?.parentId ?? null
}

/** The parent lineage node for a fork, or null when it has no live parent. */
export async function getForkParent(workspaceId: string): Promise<ForkLineageNode | null> {
  const parentId = await getForkParentId(workspaceId)
  if (!parentId) return null
  const [row] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      organizationId: workspace.organizationId,
    })
    .from(workspace)
    .where(and(eq(workspace.id, parentId), isNull(workspace.archivedAt)))
    .limit(1)
  return row ?? null
}

/** The live direct children forked from this workspace. */
export async function getForkChildren(workspaceId: string): Promise<ForkLineageNode[]> {
  return db
    .select({
      id: workspace.id,
      name: workspace.name,
      organizationId: workspace.organizationId,
    })
    .from(workspace)
    .where(and(eq(workspace.forkedFromWorkspaceId, workspaceId), isNull(workspace.archivedAt)))
}

/** The parent plus direct children of a workspace, for lineage display. */
export async function getForkLineage(
  workspaceId: string
): Promise<{ parent: ForkLineageNode | null; children: ForkLineageNode[] }> {
  const [parent, children] = await Promise.all([
    getForkParent(workspaceId),
    getForkChildren(workspaceId),
  ])
  return { parent, children }
}

/**
 * Resolve the strict fork edge between two workspaces, identifying which is the
 * child (the one whose `forkedFromWorkspaceId` points at the other). Returns
 * null when the two workspaces are not a direct parent/child pair.
 */
export async function resolveForkEdge(
  workspaceAId: string,
  workspaceBId: string
): Promise<ForkEdge | null> {
  if (workspaceAId === workspaceBId) return null
  if ((await getForkParentId(workspaceAId)) === workspaceBId) {
    return { childWorkspaceId: workspaceAId, parentWorkspaceId: workspaceBId }
  }
  if ((await getForkParentId(workspaceBId)) === workspaceAId) {
    return { childWorkspaceId: workspaceBId, parentWorkspaceId: workspaceAId }
  }
  return null
}

/**
 * Serialize concurrent promote/rollback on a fork edge with a transaction-scoped
 * advisory lock keyed by the edge (the child workspace id). `hashtextextended`
 * (64-bit, matching every other advisory lock in the repo) makes a collision
 * between distinct keys astronomically unlikely; a collision would only cause
 * unnecessary serialization, never a correctness issue.
 */
export async function acquireForkEdgeLock(tx: DbOrTx, childWorkspaceId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`fork-edge:${childWorkspaceId}`}, 0))`
  )
}

/**
 * Serialize every promote/rollback whose TARGET is this workspace. Sibling forks
 * promote into the same parent on different edge locks, so the edge lock alone does
 * not serialize them; this lock does, keeping concurrent syncs into one target from
 * interleaving and keeping rollback's "newest sync" check race-free. Always acquire
 * this BEFORE {@link acquireForkEdgeLock} so the two are taken in a consistent order.
 */
export async function acquireForkTargetLock(tx: DbOrTx, targetWorkspaceId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`fork-target:${targetWorkspaceId}`}, 0))`
  )
}
