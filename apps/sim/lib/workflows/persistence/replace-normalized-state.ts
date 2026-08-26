import { db } from '@sim/db'
import { workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
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

/** The three global-primary-key id families one normalized write inserts. */
export interface WorkflowGraphIds {
  blockIds: string[]
  edgeIds: string[]
  subflowIds: string[]
}

/**
 * The ids a write of `state` would insert.
 *
 * Derived from the prepared state rather than from the caller's body, and read
 * by both the dry-run preview and the committed write, so the two cannot
 * disagree about what is about to be claimed.
 *
 * Each family is read from whichever side `saveWorkflowToNormalizedTables`
 * inserts, which is not the same side for all three. Blocks are inserted as
 * `block.id` — the record's own field, taken from `Object.values` — so a body
 * whose record key differs from the block's `id` is checked on the value that
 * reaches the table. Subflow rows are the opposite: their ids come from
 * `generateLoopBlocks`/`generateParallelBlocks`, which key every container by
 * its record key, so those are collected from `Object.keys`.
 *
 * Subflow ids are collected separately even though they are container block
 * ids: `workflow_subflows` has its own global primary key, so the same value
 * can be free as a block id and taken as a subflow id.
 */
export function collectWorkflowGraphIds(state: PreparedWorkflowState): WorkflowGraphIds {
  return {
    blockIds: Object.values(state.blocks).map((block) => block.id),
    edgeIds: state.edges.map((edge) => edge.id),
    subflowIds: [...Object.keys(state.loops), ...Object.keys(state.parallels)],
  }
}

/** How many offending ids a conflict message names before it summarizes the rest. */
const MAX_REPORTED_CONFLICT_IDS = 5

/**
 * Renders the offending ids, and only the ids.
 *
 * Never the workflow or workspace that holds them: the caller supplied these
 * values, so naming them back discloses nothing they did not already have,
 * where naming the owner would.
 */
function describeClaimedIds(ids: string[]): string {
  const sorted = [...ids].sort()
  const shown = sorted.slice(0, MAX_REPORTED_CONFLICT_IDS).join(', ')
  const remaining = sorted.length - MAX_REPORTED_CONFLICT_IDS
  return remaining > 0 ? `${shown} (and ${remaining} more)` : shown
}

/**
 * Refuses a graph whose ids are already owned by a different workflow.
 *
 * `workflow_blocks.id`, `workflow_edges.id`, and `workflow_subflows.id` are
 * global primary keys, but the replace deletes only the rows scoped to this
 * workflow — so an id owned elsewhere survives the delete and the insert faults
 * on it. Detecting it here turns a caller-reachable 500 into a 409 that names
 * what to change.
 *
 * The `ne(workflowId)` half is what keeps the ordinary round-trip working: ids
 * this workflow already holds are deleted before the insert, so they are not a
 * conflict.
 */
export async function assertWorkflowGraphIdsUnclaimed(
  executor: DbOrTx,
  workflowId: string,
  ids: WorkflowGraphIds
): Promise<void> {
  const [blocks, edges, subflows] = await Promise.all([
    ids.blockIds.length > 0
      ? executor
          .select({ id: workflowBlocks.id })
          .from(workflowBlocks)
          .where(
            and(inArray(workflowBlocks.id, ids.blockIds), ne(workflowBlocks.workflowId, workflowId))
          )
      : Promise.resolve([] as { id: string }[]),
    ids.edgeIds.length > 0
      ? executor
          .select({ id: workflowEdges.id })
          .from(workflowEdges)
          .where(
            and(inArray(workflowEdges.id, ids.edgeIds), ne(workflowEdges.workflowId, workflowId))
          )
      : Promise.resolve([] as { id: string }[]),
    ids.subflowIds.length > 0
      ? executor
          .select({ id: workflowSubflows.id })
          .from(workflowSubflows)
          .where(
            and(
              inArray(workflowSubflows.id, ids.subflowIds),
              ne(workflowSubflows.workflowId, workflowId)
            )
          )
      : Promise.resolve([] as { id: string }[]),
  ])

  const conflicts: string[] = []
  if (blocks.length > 0) {
    conflicts.push(
      `Block ids already used by another workflow: ${describeClaimedIds(blocks.map((row) => row.id))}`
    )
  }
  if (edges.length > 0) {
    conflicts.push(
      `Edge ids already used by another workflow: ${describeClaimedIds(edges.map((row) => row.id))}`
    )
  }
  if (subflows.length > 0) {
    conflicts.push(
      `Subflow ids already used by another workflow: ${describeClaimedIds(subflows.map((row) => row.id))}`
    )
  }

  if (conflicts.length > 0) {
    throw new OrchestrationError('conflict', conflicts.join('; '))
  }
}

/** Postgres SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505'

const GRAPH_ID_CONSTRAINTS = [
  'workflow_blocks_pkey',
  'workflow_edges_pkey',
  'workflow_subflows_pkey',
] as const

/**
 * Whether a driver fault is another workflow having claimed one of these ids.
 *
 * The pre-check is the good-message path, not the correctness boundary: the
 * row lock covers the target workflow, not the workflow that would claim an id,
 * so under READ COMMITTED two concurrent writes carrying the same fresh id can
 * both pass the check and one insert still faults. This keeps that race a 409.
 *
 * Read through the `cause` chain: Drizzle wraps every driver fault in a
 * `DrizzleQueryError` whose own message is the SQL text and whose `code` is
 * absent, so a top-level field read never sees the driver's SQLSTATE. The
 * constraint name is compared exactly rather than searched for in a message,
 * so an unrelated constraint merely containing one of these names is not
 * misclassified.
 */
function isGraphIdUniqueViolation(error: unknown): boolean {
  if (getPostgresErrorCode(error) !== UNIQUE_VIOLATION) return false
  const constraint = getPostgresConstraintName(error)
  return GRAPH_ID_CONSTRAINTS.some((name) => name === constraint)
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

    await assertWorkflowGraphIdsUnclaimed(tx, workflowId, collectWorkflowGraphIds(prepared.state))

    let result: Awaited<ReturnType<typeof saveWorkflowToNormalizedTables>>
    try {
      result = await saveWorkflowToNormalizedTables(workflowId, workflowState, tx)
    } catch (error) {
      if (isGraphIdUniqueViolation(error)) {
        throw new OrchestrationError(
          'conflict',
          'Another workflow claimed one of the submitted block, edge, or subflow ids while this write was in flight'
        )
      }
      throw error
    }
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
