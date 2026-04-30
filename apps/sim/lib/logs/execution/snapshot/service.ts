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

    const [upsertedSnapshot] = await db
      .insert(workflowExecutionSnapshots)
      .values(snapshotData)
      .onConflictDoUpdate({
        target: [workflowExecutionSnapshots.workflowId, workflowExecutionSnapshots.stateHash],
        set: {
          stateData: sql`excluded.state_data`,
        },
      })
      .returning()

    const isNew = upsertedSnapshot.id === snapshotData.id

    logger.info(
      isNew
        ? `Created new snapshot for workflow ${workflowId} (hash: ${stateHash.slice(0, 12)}..., blocks: ${Object.keys(state.blocks || {}).length})`
        : `Reusing existing snapshot for workflow ${workflowId} (hash: ${stateHash.slice(0, 12)}...)`
    )

    return {
      snapshot: {
        ...upsertedSnapshot,
        stateData: upsertedSnapshot.stateData as WorkflowState,
        createdAt: upsertedSnapshot.createdAt.toISOString(),
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
