import { createHash } from 'crypto'
import { db } from '@sim/db'
import { workflowExecutionLogs, workflowExecutionSnapshots } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, lt, notExists, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
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
      id: uuidv4(),
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

  async getSnapshotByHash(
    workflowId: string,
    hash: string
  ): Promise<WorkflowExecutionSnapshot | null> {
    const [snapshot] = await db
      .select()
      .from(workflowExecutionSnapshots)
      .where(
        and(
          eq(workflowExecutionSnapshots.workflowId, workflowId),
          eq(workflowExecutionSnapshots.stateHash, hash)
        )
      )
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
    return createHash('sha256').update(stateString).digest('hex')
  }

  async cleanupOrphanedSnapshots(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    const deletedSnapshots = await db
      .delete(workflowExecutionSnapshots)
      .where(
        and(
          lt(workflowExecutionSnapshots.createdAt, cutoffDate),
          notExists(
            db
              .select({ id: workflowExecutionLogs.id })
              .from(workflowExecutionLogs)
              .where(eq(workflowExecutionLogs.stateSnapshotId, workflowExecutionSnapshots.id))
          )
        )
      )
      .returning({ id: workflowExecutionSnapshots.id })

    const deletedCount = deletedSnapshots.length
    logger.info(`Cleaned up ${deletedCount} orphaned snapshots older than ${olderThanDays} days`)
    return deletedCount
  }
}

export const snapshotService = new SnapshotService()
