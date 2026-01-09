import { createHash } from 'crypto'
import { db } from '@sim/db'
import { workflowExecutionSnapshots } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, lt } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type {
  SnapshotService as ISnapshotService,
  SnapshotCreationResult,
  WorkflowExecutionSnapshot,
  WorkflowExecutionSnapshotInsert,
  WorkflowState,
} from '@/lib/logs/types'
import {
  normalizedStringify,
  normalizeEdge,
  normalizeValue,
  sortEdges,
} from '@/lib/workflows/comparison'

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
      logger.debug(`Reusing existing snapshot for workflow ${workflowId} with hash ${stateHash}`)
      return {
        snapshot: existingSnapshot,
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

    logger.debug(`Created new snapshot for workflow ${workflowId} with hash ${stateHash}`)
    logger.debug(`Stored full state with ${Object.keys(state.blocks || {}).length} blocks`)
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
    const normalizedState = this.normalizeStateForHashing(state)
    const stateString = normalizedStringify(normalizedState)
    return createHash('sha256').update(stateString).digest('hex')
  }

  async cleanupOrphanedSnapshots(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    const deletedSnapshots = await db
      .delete(workflowExecutionSnapshots)
      .where(lt(workflowExecutionSnapshots.createdAt, cutoffDate))
      .returning({ id: workflowExecutionSnapshots.id })

    const deletedCount = deletedSnapshots.length
    logger.info(`Cleaned up ${deletedCount} orphaned snapshots older than ${olderThanDays} days`)
    return deletedCount
  }

  private normalizeStateForHashing(state: WorkflowState): any {
    // 1. Normalize and sort edges
    const normalizedEdges = sortEdges((state.edges || []).map(normalizeEdge))

    // 2. Normalize blocks
    const normalizedBlocks: Record<string, any> = {}

    for (const [blockId, block] of Object.entries(state.blocks || {})) {
      const { position, layout, height, ...blockWithoutLayoutFields } = block

      // Also exclude width/height from data object (container dimensions from autolayout)
      const {
        width: _dataWidth,
        height: _dataHeight,
        ...dataRest
      } = blockWithoutLayoutFields.data || {}

      // Normalize subBlocks
      const subBlocks = blockWithoutLayoutFields.subBlocks || {}
      const normalizedSubBlocks: Record<string, any> = {}

      for (const [subBlockId, subBlock] of Object.entries(subBlocks)) {
        const value = subBlock.value ?? null

        normalizedSubBlocks[subBlockId] = {
          type: subBlock.type,
          value: normalizeValue(value),
          ...Object.fromEntries(
            Object.entries(subBlock).filter(([key]) => key !== 'value' && key !== 'type')
          ),
        }
      }

      normalizedBlocks[blockId] = {
        ...blockWithoutLayoutFields,
        data: dataRest,
        subBlocks: normalizedSubBlocks,
      }
    }

    // 3. Normalize loops and parallels
    const normalizedLoops: Record<string, any> = {}
    for (const [loopId, loop] of Object.entries(state.loops || {})) {
      normalizedLoops[loopId] = normalizeValue(loop)
    }

    const normalizedParallels: Record<string, any> = {}
    for (const [parallelId, parallel] of Object.entries(state.parallels || {})) {
      normalizedParallels[parallelId] = normalizeValue(parallel)
    }

    // 4. Normalize variables (if present)
    const normalizedVariables = state.variables ? normalizeValue(state.variables) : undefined

    return {
      blocks: normalizedBlocks,
      edges: normalizedEdges,
      loops: normalizedLoops,
      parallels: normalizedParallels,
      ...(normalizedVariables !== undefined && { variables: normalizedVariables }),
    }
  }
}

export const snapshotService = new SnapshotService()
