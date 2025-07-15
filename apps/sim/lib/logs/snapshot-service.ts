import { createHash } from 'crypto'
import { and, eq, lt } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import type {
  SnapshotService as ISnapshotService,
  SnapshotCreationResult,
  WorkflowExecutionSnapshot,
  WorkflowExecutionSnapshotInsert,
  WorkflowState,
} from '@/lib/logs/types'
import { db } from '@/db'
import { workflowExecutionSnapshots } from '@/db/schema'

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
      stateData: state, // Full state with positions, subblock values, etc.
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
    const stateString = this.normalizedStringify(normalizedState)
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
    // Use the same normalization logic as hasWorkflowChanged for consistency

    // 1. Normalize edges (same as hasWorkflowChanged)
    const normalizedEdges = (state.edges || [])
      .map((edge) => ({
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
        targetHandle: edge.targetHandle,
      }))
      .sort((a, b) =>
        `${a.source}-${a.sourceHandle}-${a.target}-${a.targetHandle}`.localeCompare(
          `${b.source}-${b.sourceHandle}-${b.target}-${b.targetHandle}`
        )
      )

    // 2. Normalize blocks (same as hasWorkflowChanged)
    const normalizedBlocks: Record<string, any> = {}

    for (const [blockId, block] of Object.entries(state.blocks || {})) {
      // Skip position as it doesn't affect functionality
      const { position, ...blockWithoutPosition } = block

      // Handle subBlocks with detailed comparison (same as hasWorkflowChanged)
      const subBlocks = blockWithoutPosition.subBlocks || {}
      const normalizedSubBlocks: Record<string, any> = {}

      for (const [subBlockId, subBlock] of Object.entries(subBlocks)) {
        // Normalize value with special handling for null/undefined
        const value = subBlock.value ?? null

        normalizedSubBlocks[subBlockId] = {
          type: subBlock.type,
          value: this.normalizeValue(value),
          // Include other properties except value
          ...Object.fromEntries(
            Object.entries(subBlock).filter(([key]) => key !== 'value' && key !== 'type')
          ),
        }
      }

      normalizedBlocks[blockId] = {
        ...blockWithoutPosition,
        subBlocks: normalizedSubBlocks,
      }
    }

    // 3. Normalize loops and parallels
    const normalizedLoops: Record<string, any> = {}
    for (const [loopId, loop] of Object.entries(state.loops || {})) {
      normalizedLoops[loopId] = this.normalizeValue(loop)
    }

    const normalizedParallels: Record<string, any> = {}
    for (const [parallelId, parallel] of Object.entries(state.parallels || {})) {
      normalizedParallels[parallelId] = this.normalizeValue(parallel)
    }

    return {
      blocks: normalizedBlocks,
      edges: normalizedEdges,
      loops: normalizedLoops,
      parallels: normalizedParallels,
    }
  }

  private normalizeValue(value: any): any {
    // Handle null/undefined consistently
    if (value === null || value === undefined) return null

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeValue(item))
    }

    // Handle objects
    if (typeof value === 'object') {
      const normalized: Record<string, any> = {}
      for (const [key, val] of Object.entries(value)) {
        normalized[key] = this.normalizeValue(val)
      }
      return normalized
    }

    // Handle primitives
    return value
  }

  private normalizedStringify(obj: any): string {
    if (obj === null || obj === undefined) return 'null'
    if (typeof obj === 'string') return `"${obj}"`
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj)

    if (Array.isArray(obj)) {
      return `[${obj.map((item) => this.normalizedStringify(item)).join(',')}]`
    }

    if (typeof obj === 'object') {
      const keys = Object.keys(obj).sort()
      const pairs = keys.map((key) => `"${key}":${this.normalizedStringify(obj[key])}`)
      return `{${pairs.join(',')}}`
    }

    return String(obj)
  }
}

export const snapshotService = new SnapshotService()
