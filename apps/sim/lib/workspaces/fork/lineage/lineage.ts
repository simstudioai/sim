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
 * How long a fork transaction waits for a lock before aborting. Bounds the wait on the
 * target/edge advisory locks (and any incidental row lock) so a contended sync into the
 * same target fails fast and returns its pooled connection instead of piling waiters up
 * and stagnating the pool at scale. 10s favors completing a legit sync queued behind an
 * in-flight one, while still tripping on a pathological hold. Connection-level timeouts
 * are not used (PlanetScale rejects them) - this is transaction-scoped only.
 */
const FORK_LOCK_TIMEOUT_MS = 10_000

/**
 * Apply {@link FORK_LOCK_TIMEOUT_MS} to the current transaction (`set_config(local)`),
 * so it covers `pg_advisory_xact_lock` waits too. Call at the very start of a fork
 * transaction, before acquiring any lock.
 */
export async function setForkLockTimeout(tx: DbOrTx): Promise<void> {
  await tx.execute(sql`select set_config('lock_timeout', ${`${FORK_LOCK_TIMEOUT_MS}ms`}, true)`)
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
