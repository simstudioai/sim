import { createHash } from 'crypto'
import { eq, and, lt } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/db'
import { workflowExecutionSnapshots } from '@/db/schema'
import { createLogger } from './console-logger'
import type {
  WorkflowState,
  WorkflowExecutionSnapshot,
  WorkflowExecutionSnapshotInsert,
  SnapshotCreationResult,
  SnapshotService as ISnapshotService,
} from './types'


const logger = createLogger('SnapshotService')

export class SnapshotService implements ISnapshotService {
  async createSnapshot(workflowId: string, state: WorkflowState): Promise<WorkflowExecutionSnapshot> {
    const result = await this.createSnapshotWithDeduplication(workflowId, state)
    return result.snapshot
  }

  async createSnapshotWithDeduplication(
    workflowId: string,
    state: WorkflowState
  ): Promise<SnapshotCreationResult> {
    const stateHash = this.computeStateHash(state)

    const existingSnapshot = await this.getSnapshotByHash(workflowId, stateHash)
    if (existingSnapshot) {
      logger.debug(`Reusing existing snapshot for workflow ${workflowId} with hash ${stateHash}`)
      return {
        snapshot: existingSnapshot,
        isNew: false,
      }
    }

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
    const normalizedBlocks: Record<string, any> = {}

    for (const [blockId, block] of Object.entries(state.blocks || {})) {
      const { position, ...blockWithoutPosition } = block

      const normalizedSubBlocks: Record<string, any> = {}
      for (const [subBlockId, subBlock] of Object.entries(blockWithoutPosition.subBlocks || {})) {
        normalizedSubBlocks[subBlockId] = {
          type: subBlock.type,
          value: subBlock.value,
        }
      }

      normalizedBlocks[blockId] = {
        ...blockWithoutPosition,
        subBlocks: normalizedSubBlocks,
      }
    }

    const normalizedEdges = (state.edges || [])
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      }))
      .sort((a, b) => {
        if (a.source !== b.source) return a.source.localeCompare(b.source)
        if (a.target !== b.target) return a.target.localeCompare(b.target)
        return (a.sourceHandle || '').localeCompare(b.sourceHandle || '')
      })

    return {
      blocks: normalizedBlocks,
      edges: normalizedEdges,
      loops: state.loops || {},
      parallels: state.parallels || {},
    }
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
