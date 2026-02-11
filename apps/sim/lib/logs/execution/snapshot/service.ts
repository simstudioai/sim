import { createHash } from 'crypto'
import { db } from '@sim/db'
import { workflowExecutionLogs, workflowExecutionSnapshots } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, lt, notExists } from 'drizzle-orm'
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
    // Hash the position-less state for deduplication (functional equivalence)
    const stateHash = this.computeStateHash(state)

    const existingSnapshot = await this.getSnapshotByHash(workflowId, stateHash)
    if (existingSnapshot) {
      let refreshedState: WorkflowState = existingSnapshot.stateData
      try {
        await db
          .update(workflowExecutionSnapshots)
          .set({ stateData: state })
          .where(eq(workflowExecutionSnapshots.id, existingSnapshot.id))
        refreshedState = state
      } catch (error) {
        logger.warn(
          `Failed to refresh snapshot stateData for ${existingSnapshot.id}, continuing with existing data`,
          error
        )
      }

      logger.info(
        `Reusing existing snapshot for workflow ${workflowId} (hash: ${stateHash.slice(0, 12)}...)`
      )
      return {
        snapshot: { ...existingSnapshot, stateData: refreshedState },
        isNew: false,
      }
    }

    // Store the FULL state (including positions) so we can recreate the exact workflow
    // Even though we hash without positions, we want to preserve the complete state
    const snapshotData: WorkflowExecutionSnapshotInsert = {
      id: uuidv4(),
      workflowId,
      stateHash,
      stateData: state,
    }

    const [newSnapshot] = await db
      .insert(workflowExecutionSnapshots)
      .values(snapshotData)
      .returning()

    logger.info(
      `Created new snapshot for workflow ${workflowId} (hash: ${stateHash.slice(0, 12)}..., blocks: ${Object.keys(state.blocks || {}).length})`
    )
    return {
      snapshot: {
        ...newSnapshot,
        stateData: newSnapshot.stateData as WorkflowState,
        createdAt: newSnapshot.createdAt.toISOString(),
      },
      isNew: true,
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
