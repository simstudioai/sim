import { db } from '@sim/db'
import {
  workflowEvalRunTarget,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, lt, notExists, sql } from 'drizzle-orm'
import { workflowStateSchema } from '@/lib/api/contracts/workflows'
import type { DbOrTx } from '@/lib/db/types'
import type {
  SnapshotService as ISnapshotService,
  SnapshotCreationResult,
  WorkflowExecutionSnapshot,
  WorkflowExecutionSnapshotInsert,
  WorkflowState,
} from '@/lib/logs/types'
import { normalizedStringify, normalizeWorkflowState } from '@/lib/workflows/comparison'

const logger = createLogger('SnapshotService')

export const MAX_WORKFLOW_EXECUTION_SNAPSHOT_BYTES = 10 * 1024 * 1024

function canonicalizeSnapshotValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value

  if (Array.isArray(value)) {
    return value.map(canonicalizeSnapshotValue)
  }

  const canonical: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const child = canonicalizeSnapshotValue((value as Record<string, unknown>)[key])
    if (child !== undefined) canonical[key] = child
  }
  return canonical
}

function canonicalStringifySnapshotState(state: WorkflowState): string {
  const serialized = JSON.stringify(canonicalizeSnapshotValue(state))
  if (serialized === undefined) {
    throw new Error('Workflow snapshot state cannot be serialized')
  }
  return serialized
}

function validateSnapshotState(state: unknown, snapshotId: string): WorkflowState {
  const parsed = workflowStateSchema.safeParse(state)
  if (!parsed.success) {
    throw new Error(`Workflow snapshot ${snapshotId} contains invalid workflow state`)
  }

  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`Workflow snapshot ${snapshotId} contains invalid workflow state`)
  }

  const candidate = state as Record<string, unknown>
  if (
    !candidate.loops ||
    typeof candidate.loops !== 'object' ||
    Array.isArray(candidate.loops) ||
    !candidate.parallels ||
    typeof candidate.parallels !== 'object' ||
    Array.isArray(candidate.parallels)
  ) {
    throw new Error(`Workflow snapshot ${snapshotId} contains invalid workflow state`)
  }

  return state as WorkflowState
}

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
    state: WorkflowState,
    executor: DbOrTx = db
  ): Promise<SnapshotCreationResult> {
    return this.createSnapshotForHash(workflowId, state, this.computeStateHash(state), executor)
  }

  async createExactSnapshotWithDeduplication(
    workflowId: string,
    state: WorkflowState,
    executor: DbOrTx = db
  ): Promise<SnapshotCreationResult> {
    return this.createSnapshotForHash(
      workflowId,
      state,
      this.computeExactStateHash(state),
      executor,
      true
    )
  }

  private async createSnapshotForHash(
    workflowId: string,
    state: WorkflowState,
    stateHash: string,
    executor: DbOrTx,
    requireExactState = false
  ): Promise<SnapshotCreationResult> {
    const snapshotData: WorkflowExecutionSnapshotInsert = {
      id: generateId(),
      workflowId,
      stateHash,
      stateData: state,
    }

    /**
     * Insert the snapshot, or — when an identical (workflowId, stateHash) row
     * already exists — return it without rewriting the large stateData jsonb.
     *
     * The selected hash contract determines whether state is semantically or
     * exactly identical. The upsert does not rewrite the large stateData JSONB.
     * It updates only the small state_hash column to itself so RETURNING remains
     * atomic and cannot race with snapshot cleanup.
     */
    const [upsertedSnapshot] = await executor
      .insert(workflowExecutionSnapshots)
      .values(snapshotData)
      .onConflictDoUpdate({
        target: [workflowExecutionSnapshots.workflowId, workflowExecutionSnapshots.stateHash],
        set: {
          stateHash: sql`excluded.state_hash`,
        },
      })
      .returning()

    if (!upsertedSnapshot) {
      throw new Error(`Failed to create workflow snapshot for workflow ${workflowId}`)
    }

    if (
      requireExactState &&
      canonicalStringifySnapshotState(upsertedSnapshot.stateData as WorkflowState) !==
        canonicalStringifySnapshotState(state)
    ) {
      throw new Error(
        `Workflow snapshot hash collision returned mismatched state for workflow ${workflowId}`
      )
    }

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

  /**
   * Loads a trusted workflow snapshot without allowing its JSONB state to cross
   * the database boundary until its serialized size has passed a hard cap.
   */
  async getBoundedSnapshotForWorkflow(
    id: string,
    workflowId: string
  ): Promise<WorkflowExecutionSnapshot> {
    const [metadata] = await db
      .select({
        workflowId: workflowExecutionSnapshots.workflowId,
        stateHash: workflowExecutionSnapshots.stateHash,
        stateBytes: sql<number>`octet_length(${workflowExecutionSnapshots.stateData}::text)`,
      })
      .from(workflowExecutionSnapshots)
      .where(eq(workflowExecutionSnapshots.id, id))
      .limit(1)

    if (!metadata) {
      throw new Error(`Workflow snapshot ${id} was not found`)
    }
    if (metadata.workflowId !== workflowId) {
      throw new Error(`Workflow snapshot ${id} does not belong to workflow ${workflowId}`)
    }
    if (metadata.stateBytes > MAX_WORKFLOW_EXECUTION_SNAPSHOT_BYTES) {
      throw new Error(
        `Workflow snapshot ${id} exceeds ${MAX_WORKFLOW_EXECUTION_SNAPSHOT_BYTES} serialized bytes`
      )
    }
    if (!/^[a-f0-9]{64}$/.test(metadata.stateHash)) {
      throw new Error(`Workflow snapshot ${id} has an invalid state hash`)
    }

    const [snapshot] = await db
      .select()
      .from(workflowExecutionSnapshots)
      .where(
        and(
          eq(workflowExecutionSnapshots.id, id),
          eq(workflowExecutionSnapshots.workflowId, workflowId),
          sql`octet_length(${workflowExecutionSnapshots.stateData}::text) <= ${MAX_WORKFLOW_EXECUTION_SNAPSHOT_BYTES}`
        )
      )
      .limit(1)

    if (!snapshot) {
      throw new Error(`Workflow snapshot ${id} changed or disappeared while loading`)
    }
    if (snapshot.stateHash !== metadata.stateHash) {
      throw new Error(`Workflow snapshot ${id} changed while loading`)
    }

    const stateData = validateSnapshotState(snapshot.stateData, id)
    if (this.computeExactStateHash(stateData) !== snapshot.stateHash) {
      throw new Error(`Workflow snapshot ${id} failed state hash validation`)
    }

    return {
      ...snapshot,
      stateData,
      createdAt: snapshot.createdAt.toISOString(),
    }
  }

  computeStateHash(state: WorkflowState): string {
    const normalizedState = normalizeWorkflowState(state)
    const stateString = normalizedStringify(normalizedState)
    return sha256Hex(stateString)
  }

  computeExactStateHash(state: WorkflowState): string {
    return sha256Hex(canonicalStringifySnapshotState(state))
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
            ),
            notExists(
              db
                .select({ one: sql`1` })
                .from(workflowEvalRunTarget)
                .where(eq(workflowEvalRunTarget.snapshotId, workflowExecutionSnapshots.id))
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
            ),
            notExists(
              db
                .select({ one: sql`1` })
                .from(workflowEvalRunTarget)
                .where(eq(workflowEvalRunTarget.snapshotId, workflowExecutionSnapshots.id))
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
