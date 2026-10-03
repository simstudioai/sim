import { dbFor } from '@sim/db'
import { workflowExecutionLogs, workflowExecutionSnapshots } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, lt, notExists, sql } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { consumeRowBudget, type RowBudget } from '@/lib/cleanup/batch-delete'
import type { WorkflowState } from '@/lib/logs/types'
import { normalizedStringify, normalizeWorkflowState } from '@/lib/workflows/comparison'

const logger = createLogger('SnapshotService')

const SNAPSHOT_ID_CACHE_MAX_ENTRIES = 1000
const SNAPSHOT_ID_CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Remembers which row holds a workflow's snapshot for a state hash, so repeat runs
 * of an unchanged workflow neither look it up nor ship its (often hundreds of KB)
 * state to the database. Only ids a log row was just inserted against are
 * remembered: orphan cleanup deletes only unreferenced snapshots, so a referenced id
 * stays valid for the entry's lifetime. A caller that still hits a missing row
 * resolves again with `{ fresh: true }`.
 */
const snapshotIdCache = new LRUCache<string, string>({
  max: SNAPSHOT_ID_CACHE_MAX_ENTRIES,
  ttl: SNAPSHOT_ID_CACHE_TTL_MS,
})

/** The snapshot row holding one workflow's state, identified by the state's hash. */
export interface ResolvedSnapshot {
  id: string
  workflowId: string
  stateHash: string
}

const snapshotCacheKey = ({ workflowId, stateHash }: Omit<ResolvedSnapshot, 'id'>) =>
  `${workflowId}:${stateHash}`

export class SnapshotService {
  /**
   * Resolves the snapshot row holding `state` for `workflowId`, creating the row
   * only when no identical state (same normalized hash) is stored yet.
   */
  async resolveSnapshot(
    workflowId: string,
    state: WorkflowState,
    options: { fresh?: boolean } = {}
  ): Promise<ResolvedSnapshot> {
    const stateHash = this.computeStateHash(state)
    if (!options.fresh) {
      const cachedId = snapshotIdCache.get(snapshotCacheKey({ workflowId, stateHash }))
      if (cachedId) return { id: cachedId, workflowId, stateHash }
    }

    const [existing] = await dbFor('exec')
      .select({ id: workflowExecutionSnapshots.id })
      .from(workflowExecutionSnapshots)
      .where(
        and(
          eq(workflowExecutionSnapshots.workflowId, workflowId),
          eq(workflowExecutionSnapshots.stateHash, stateHash)
        )
      )
      .limit(1)

    const id = existing?.id ?? (await this.insertSnapshot(workflowId, stateHash, state))
    return { id, workflowId, stateHash }
  }

  /** Remembers a snapshot once a log row referencing it has been inserted. */
  rememberReferencedSnapshot(snapshot: ResolvedSnapshot): void {
    snapshotIdCache.set(snapshotCacheKey(snapshot), snapshot.id)
  }

  /**
   * Inserts the snapshot, or — when a concurrent run stored the identical
   * (workflowId, stateHash) row first — returns that row's id without rewriting it.
   *
   * The hash is a sha256 of the normalized state, so an existing row's stateData is
   * byte-identical; there is nothing to update. SET touches only the small
   * state_hash column so the upsert still RETURNs the row's id, while the unchanged,
   * TOASTed stateData keeps its existing out-of-line storage.
   */
  private async insertSnapshot(
    workflowId: string,
    stateHash: string,
    state: WorkflowState
  ): Promise<string> {
    const [row] = await dbFor('exec')
      .insert(workflowExecutionSnapshots)
      .values({ id: generateId(), workflowId, stateHash, stateData: state })
      .onConflictDoUpdate({
        target: [workflowExecutionSnapshots.workflowId, workflowExecutionSnapshots.stateHash],
        set: { stateHash: sql`excluded.state_hash` },
      })
      .returning({ id: workflowExecutionSnapshots.id })

    logger.info(
      `Stored snapshot for workflow ${workflowId} (hash: ${stateHash.slice(0, 12)}..., blocks: ${Object.keys(state.blocks || {}).length})`
    )
    return row.id
  }

  computeStateHash(state: WorkflowState): string {
    const normalizedState = normalizeWorkflowState(state)
    const stateString = normalizedStringify(normalizedState)
    return sha256Hex(stateString)
  }

  /** Only invoked from the cleanup-logs background job, so it runs on the cleanup pool. */
  async cleanupOrphanedSnapshots(olderThanDays: number, budget?: RowBudget): Promise<number> {
    const cleanupDb = dbFor('cleanup')
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    const BATCH_SIZE = 1000
    const MAX_BATCHES = 20

    let totalDeleted = 0
    let stoppedEarly = false

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      if (budget?.remaining === 0) break
      const candidates = await cleanupDb
        .select({ id: workflowExecutionSnapshots.id })
        .from(workflowExecutionSnapshots)
        .where(
          and(
            lt(workflowExecutionSnapshots.createdAt, cutoffDate),
            notExists(
              cleanupDb
                .select({ one: sql`1` })
                .from(workflowExecutionLogs)
                .where(eq(workflowExecutionLogs.stateSnapshotId, workflowExecutionSnapshots.id))
            )
          )
        )
        .limit(Math.min(BATCH_SIZE, budget?.remaining ?? BATCH_SIZE))

      if (candidates.length === 0) break

      consumeRowBudget(budget, candidates.length)
      const ids = candidates.map((c) => c.id)
      const deleted = await cleanupDb
        .delete(workflowExecutionSnapshots)
        .where(
          and(
            inArray(workflowExecutionSnapshots.id, ids),
            notExists(
              cleanupDb
                .select({ one: sql`1` })
                .from(workflowExecutionLogs)
                .where(eq(workflowExecutionLogs.stateSnapshotId, workflowExecutionSnapshots.id))
            )
          )
        )
        .returning({ id: workflowExecutionSnapshots.id })

      totalDeleted += deleted.length

      if (candidates.length < BATCH_SIZE) break
      if (batch === MAX_BATCHES - 1) stoppedEarly = true
    }

    logger.info(
      `Cleaned up ${totalDeleted} orphaned snapshots older than ${olderThanDays} days${stoppedEarly ? ' (batch cap reached, remainder deferred to next run)' : ''}`
    )
    return totalDeleted
  }
}

export const snapshotService = new SnapshotService()
