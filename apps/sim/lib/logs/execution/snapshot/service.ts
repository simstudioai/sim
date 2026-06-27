import { db } from '@sim/db'
import { workflowExecutionLogs, workflowExecutionSnapshots } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, lt, notExists, sql } from 'drizzle-orm'
import type {
  SnapshotService as ISnapshotService,
  SnapshotCreationResult,
  WorkflowExecutionSnapshot,
  WorkflowExecutionSnapshotInsert,
  WorkflowState,
} from '@/lib/logs/types'
import { normalizedStringify, normalizeWorkflowState } from '@/lib/workflows/comparison'

const logger = createLogger('SnapshotService')

export class SnapshotService implements ISnapshotService {
  async createSnapshot(
    workflowId: string,
    state: WorkflowState
  ): Promise<WorkflowExecutionSnapshot> {
    const result = await this.createSnapshotWithDeduplication(workflowId, state)
    return result.snapshot
  }

  async createSnapshotWithDeduplication(
    workflowId: string,
    state: WorkflowState
  ): Promise<SnapshotCreationResult> {
    const stateHash = this.computeStateHash(state)

    const snapshotData: WorkflowExecutionSnapshotInsert = {
      id: generateId(),
      workflowId,
      stateHash,
      stateData: state,
    }

    /**
     * Insert the snapshot, or do nothing if a row already exists for this
     * (workflowId, stateHash). The hash is a sha256 of the normalized state, so
     * an existing row's stateData is byte-identical — there is nothing to update.
     *
     * The previous implementation used onConflictDoUpdate(set state_data), which
     * rewrote the full (tens-of-KB) state jsonb on every execution. Under Postgres
     * MVCC that churned a dead tuple + TOAST/WAL per run for no change.
     * onConflictDoNothing avoids the write entirely on the reuse path.
     */
    const [insertedSnapshot] = await db
      .insert(workflowExecutionSnapshots)
      .values(snapshotData)
      .onConflictDoNothing({
        target: [workflowExecutionSnapshots.workflowId, workflowExecutionSnapshots.stateHash],
      })
      .returning()

    const isNew = Boolean(insertedSnapshot)

    /**
     * On conflict the insert returns no row, so load the existing snapshot by its
     * unique (workflowId, stateHash). A freshly created snapshot cannot be removed
     * in this window — cleanupOrphanedSnapshots only targets rows older than its
     * cutoff — so this lookup is guaranteed to resolve.
     */
    const snapshotRow =
      insertedSnapshot ??
      (
        await db
          .select()
          .from(workflowExecutionSnapshots)
          .where(
            and(
              eq(workflowExecutionSnapshots.workflowId, workflowId),
              eq(workflowExecutionSnapshots.stateHash, stateHash)
            )
          )
          .limit(1)
      )[0]

    if (!snapshotRow) {
      throw new Error(
        `Failed to create or load execution snapshot for workflow ${workflowId} (hash: ${stateHash.slice(0, 12)}...)`
      )
    }

    logger.info(
      isNew
        ? `Created new snapshot for workflow ${workflowId} (hash: ${stateHash.slice(0, 12)}..., blocks: ${Object.keys(state.blocks || {}).length})`
        : `Reusing existing snapshot for workflow ${workflowId} (hash: ${stateHash.slice(0, 12)}...)`
    )

    return {
      snapshot: {
        ...snapshotRow,
        stateData: snapshotRow.stateData as WorkflowState,
        createdAt: snapshotRow.createdAt.toISOString(),
      },
      isNew,
    }
  }

  async getSnapshot(id: string): Promise<WorkflowExecutionSnapshot | null> {
    const [snapshot] = await db
      .select()
      .from(workflowExecutionSnapshots)
      .where(eq(workflowExecutionSnapshots.id, id))
      .limit(1)

    if (!snapshot) return null

    return {
      ...snapshot,
      stateData: snapshot.stateData as WorkflowState,
      createdAt: snapshot.createdAt.toISOString(),
    }
  }

  computeStateHash(state: WorkflowState): string {
    const normalizedState = normalizeWorkflowState(state)
    const stateString = normalizedStringify(normalizedState)
    return sha256Hex(stateString)
  }

  async cleanupOrphanedSnapshots(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    const BATCH_SIZE = 1000
    const MAX_BATCHES = 20

    let totalDeleted = 0
    let stoppedEarly = false

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const candidates = await db
        .select({ id: workflowExecutionSnapshots.id })
        .from(workflowExecutionSnapshots)
        .where(
          and(
            lt(workflowExecutionSnapshots.createdAt, cutoffDate),
            notExists(
              db
                .select({ one: sql`1` })
                .from(workflowExecutionLogs)
                .where(eq(workflowExecutionLogs.stateSnapshotId, workflowExecutionSnapshots.id))
            )
          )
        )
        .limit(BATCH_SIZE)

      if (candidates.length === 0) break

      const ids = candidates.map((c) => c.id)
      const deleted = await db
        .delete(workflowExecutionSnapshots)
        .where(
          and(
            inArray(workflowExecutionSnapshots.id, ids),
            notExists(
              db
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
