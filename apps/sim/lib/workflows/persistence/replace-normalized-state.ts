import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { extractAndPersistCustomTools } from '@/lib/workflows/persistence/custom-tools-persistence'
import {
  type PreparedWorkflowState,
  prepareWorkflowStateForPersistence,
} from '@/lib/workflows/persistence/prepare-state'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowStateReplacement')

/** A normalized-table write that could not be committed. */
export class WorkflowStatePersistenceError extends Error {
  constructor(readonly detail: string) {
    super('Failed to save workflow state')
    this.name = 'WorkflowStatePersistenceError'
  }
}

export interface ReplaceWorkflowState {
  blocks: Record<string, BlockState>
  edges: WorkflowState['edges']
  variables?: Record<string, unknown>
  lastSaved?: number
  isDeployed?: boolean
  deployedAt?: Date | null
}

export interface ReplaceWorkflowNormalizedStateInput {
  workflowId: string
  /** Canonical workspace the workflow belongs to; custom-tool extraction is skipped without one. */
  workspaceId: string | null
  /** Owner recorded on any custom tool this graph defines. */
  attributedUserId: string
  /**
   * The graph to write, or a reader that produces it.
   *
   * A read-modify-write caller must pass the reader form: it runs after the row
   * lock is taken, inside the same transaction, so a concurrent write that
   * commits between a caller's own read and this one cannot be silently
   * overwritten by a stale graph. Passing an already-read value is correct only
   * when the caller composed it without reading the stored graph.
   */
  state: ReplaceWorkflowState | ((tx: DbOrTx) => Promise<ReplaceWorkflowState>)
  requestId?: string
}

export interface ReplaceWorkflowNormalizedStateResult {
  /** Non-fatal notes about blocks and edges the preparation step rewrote or dropped. */
  warnings: string[]
  /** Exactly what was written, after preparation. */
  state: PreparedWorkflowState
}

/**
 * The single door to replacing a workflow's draft graph.
 *
 * Owns preparation, the row-locked replace transaction, the `lastSynced`
 * stamp, the optional variables write, and best-effort custom-tool extraction.
 * It owns nothing else: authorization, the mutability check, semantic audit,
 * and the realtime notification belong to the application use case above it, so
 * a caller cannot acquire one of those by choosing a different entry point.
 *
 * Takes canonical identifiers only — never a principal or a credential — and
 * throws rather than returning a status union, because statuses are a surface's
 * business.
 *
 * `extractAndPersistCustomTools` runs **after** the transaction commits and is
 * deliberately best-effort: a failure there leaves the graph written and the
 * workspace's custom tools stale, which is the pre-existing behavior of every
 * caller and is preserved on purpose.
 */
export async function replaceWorkflowNormalizedState(
  input: ReplaceWorkflowNormalizedStateInput
): Promise<ReplaceWorkflowNormalizedStateResult> {
  const { workflowId, workspaceId, attributedUserId, state, requestId } = input
  const logPrefix = requestId ? `[${requestId}] ` : ''

  let preparedState!: PreparedWorkflowState
  let warnings: string[] = []
  let workflowState!: WorkflowState

  const saveResult = await db.transaction(async (tx) => {
    /**
     * Scoped to the workspace and to a live row, matching the predicate the
     * pre-consolidation callers used: a workflow archived between the caller's
     * authorization check and this write is refused rather than written.
     */
    const [locked] = await tx
      .select({ id: workflow.id })
      .from(workflow)
      .where(
        and(
          eq(workflow.id, workflowId),
          workspaceId ? eq(workflow.workspaceId, workspaceId) : undefined,
          isNull(workflow.archivedAt)
        )
      )
      .limit(1)
      .for('update')
    if (!locked) {
      throw new OrchestrationError('not_found', 'Workflow not found')
    }

    const resolved = typeof state === 'function' ? await state(tx) : state
    const prepared = prepareWorkflowStateForPersistence({
      blocks: resolved.blocks,
      edges: resolved.edges,
    })
    preparedState = prepared.state
    warnings = prepared.warnings
    workflowState = {
      ...prepared.state,
      lastSaved: resolved.lastSaved || Date.now(),
      isDeployed: resolved.isDeployed || false,
      deployedAt: resolved.deployedAt,
    } as WorkflowState

    const result = await saveWorkflowToNormalizedTables(workflowId, workflowState, tx)
    if (!result.success) return result

    const updateData: Partial<typeof workflow.$inferInsert> = {
      lastSynced: new Date(),
      updatedAt: new Date(),
    }
    if (resolved.variables !== undefined) {
      updateData.variables = resolved.variables
    }

    await tx.update(workflow).set(updateData).where(eq(workflow.id, workflowId))

    return result
  })

  if (!saveResult.success) {
    logger.error(`${logPrefix}Failed to save workflow ${workflowId} state`, {
      error: saveResult.error,
    })
    throw new WorkflowStatePersistenceError(saveResult.error ?? 'Unknown persistence failure')
  }

  if (workspaceId) {
    try {
      const { saved, errors } = await extractAndPersistCustomTools(
        workflowState,
        workspaceId,
        attributedUserId
      )
      if (saved > 0) {
        logger.info(`${logPrefix}Persisted ${saved} custom tool(s) to database`, { workflowId })
      }
      if (errors.length > 0) {
        logger.warn(`${logPrefix}Some custom tools failed to persist`, { errors, workflowId })
      }
    } catch (error) {
      logger.error(`${logPrefix}Failed to persist custom tools`, { error, workflowId })
    }
  } else {
    logger.warn(`${logPrefix}Workflow has no workspaceId, skipping custom tools persistence`, {
      workflowId,
    })
  }

  return { warnings, state: preparedState }
}
