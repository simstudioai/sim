import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { acquireAdvisoryXactLock, acquireAdvisoryXactLocks } from '@/lib/db/advisory-locks'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'

export interface ForkLineageNode {
  id: string
  name: string
  organizationId: string | null
}

export interface ForkLineageChild extends ForkLineageNode {
  createdAt: Date
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
 * The live (non-archived) forks created from this workspace, newest first, for
 * the Forks settings page's read-only fork list.
 */
export async function getForkChildren(workspaceId: string): Promise<ForkLineageChild[]> {
  return db
    .select({
      id: workspace.id,
      name: workspace.name,
      organizationId: workspace.organizationId,
      createdAt: workspace.createdAt,
    })
    .from(workspace)
    .where(and(eq(workspace.forkedFromWorkspaceId, workspaceId), isNull(workspace.archivedAt)))
    .orderBy(desc(workspace.createdAt))
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
export async function acquireForkEdgeLock(
  tx: DbTransaction,
  childWorkspaceId: string
): Promise<void> {
  await acquireAdvisoryXactLock(tx, 'fork_edge', `fork-edge:${childWorkspaceId}`)
}

/**
 * Serialize writes that must see one consistent view of a whole fork lineage, keyed by
 * the lineage ROOT so every member contends on the same key.
 *
 * Exclusive for the writers that change what the lineage agrees on: setting the new-workflow
 * fork-sync default (which fans out to every member) and unlink (which moves a subtree to a
 * new root). Shared for fork creation, which only inherits the source's value: forks of one
 * lineage do not conflict with each other, so they run concurrently, while a default change
 * or unlink still waits for them and they for it. Without it a fork created while the
 * default was being changed could inherit a stale value.
 *
 * ## Lock order for the whole fork module
 *
 * Every fork transaction acquires in ASCENDING rank and never reacquires a lower rank
 * afterwards. Cite the rank at each acquisition site.
 *
 * | Rank | Lock | Where |
 * | --- | --- | --- |
 * | 1 | `lockWorkspaceOperationRequest` (per-request idempotency key) | `lib/workspaces/operations/receipts` |
 * | 2 | {@link acquireForkLineageLock} (coarsest fork lock) | here |
 * | 3 | {@link acquireForkTargetLock} | here |
 * | 4 | {@link acquireForkEdgeLock} | here |
 * | 5 | `lockForkRevision` (a `resource_folders:*` advisory lock per workspace, then `FOR UPDATE` on `workspace`, `workflow`, `workflow_blocks`, `workflow_edges`, `workflow_subflows` and `FOR SHARE` on the active `workflow_deployment_version` rows) | `application/revision.ts` |
 * | 6 | remaining row locks, taken in sorted id order | various |
 *
 * Rank 5 is the easy one to get wrong: it takes `FOR UPDATE` on `workspace`, which
 * `unlinkForkEdge` and `setForkSyncDefault` write while holding rank 2, so taking rank 5
 * before rank 2 deadlocks.
 *
 * {@link setForkLockTimeout}'s 10s is not a whole-transaction bound: `lockForkRevision`
 * reaches `acquireFolderMutationLock`, which re-sets `lock_timeout` to 5s, and the MCP
 * server lock re-sets it to 3s.
 */
export async function acquireForkLineageLock(
  tx: DbTransaction,
  rootWorkspaceId: string,
  { shared = false }: { shared?: boolean } = {}
): Promise<void> {
  await acquireAdvisoryXactLocks(tx, 'fork_lineage', [
    { key: `fork-lineage:${rootWorkspaceId}`, shared },
  ])
}

/**
 * Serialize every promote/rollback whose TARGET is this workspace. Sibling forks
 * promote into the same parent on different edge locks, so the edge lock alone does
 * not serialize them; this lock does, keeping concurrent syncs into one target from
 * interleaving and keeping rollback's "newest sync" check race-free. Always acquire
 * this BEFORE {@link acquireForkEdgeLock} so the two are taken in a consistent order.
 */
export async function acquireForkTargetLock(
  tx: DbTransaction,
  targetWorkspaceId: string
): Promise<void> {
  await acquireAdvisoryXactLock(tx, 'fork_target', `fork-target:${targetWorkspaceId}`)
}
