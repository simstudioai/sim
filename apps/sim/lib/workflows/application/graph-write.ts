import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sortObjectKeysDeep } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import {
  applyTargetedLayout,
  getTargetedLayoutImpact,
  transferBlockHeights,
} from '@/lib/workflows/autolayout'
import {
  DEFAULT_HORIZONTAL_SPACING,
  DEFAULT_VERTICAL_SPACING,
} from '@/lib/workflows/autolayout/constants'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { normalizeWorkflowState } from '@/stores/workflows/workflow/validation'

/**
 * Graph-level helpers for the use cases that write a whole workflow graph. Operations apply
 * reads the stored graph and proves it unchanged under the row lock; operations apply and source
 * apply both lay out only what changed.
 */

const logger = createLogger('WorkflowGraphWrite')

/**
 * The engine models a graph as an open record; the layout helpers want the
 * canonical shape. One conversion, named, rather than a cast at each call.
 */
export function asGraph(value: Record<string, unknown>): Pick<WorkflowState, 'blocks' | 'edges'> {
  // double-cast-allowed: the edit engine models a graph as an open record; this is the one place it is read back as the canonical shape, and the layout helpers tolerate missing keys.
  return value as unknown as Pick<WorkflowState, 'blocks' | 'edges'>
}

/**
 * Loads the editable graph after the workflow row has already been resolved.
 *
 * The normalized loader projects a legitimate blockless draft as an empty
 * graph. A null result therefore remains a hard failure rather than becoming a
 * fallback graph that a write could persist after a failed read.
 */
export async function loadStoredGraph(
  workflowId: string,
  lockedTx?: DbOrTx
): Promise<Record<string, unknown>> {
  const normalized = await loadWorkflowFromNormalizedTables(workflowId, lockedTx)
  if (!normalized) {
    // The loader answers null for a failed query too. Under the row lock the
    // workflow is known to exist, so that is the only meaning left.
    if (lockedTx) {
      throw new OrchestrationError('internal', `Failed to re-read workflow ${workflowId}`)
    }
    throw new OrchestrationError('validation', `Workflow ${workflowId} has no normalized state`)
  }
  const { state, warnings } = normalizeWorkflowState({
    blocks: normalized.blocks,
    edges: normalized.edges,
    loops: normalized.loops || {},
    parallels: normalized.parallels || {},
  })
  if (warnings.length > 0) {
    logger.warn('Stored workflow state needed normalization before editing', {
      workflowId,
      warnings,
    })
  }
  // double-cast-allowed: the edit engine takes an open record; `normalizeWorkflowState` returns the canonical interface, which has no index signature.
  return state as unknown as Record<string, unknown>
}

/**
 * An order-insensitive identity for a stored graph, so two reads of the same
 * rows compare equal even though the loader neither orders its rows nor fixes
 * the key order of the records it builds.
 *
 * Only blocks and edges are compared: loops and parallels are rebuilt from the
 * blocks on every load, with child `nodes` in row order.
 */
export function storedGraphFingerprint(graph: Record<string, unknown>): string {
  const { blocks, edges } = asGraph(graph)
  const sortedEdges = [...(edges ?? [])].sort((a, b) => compareStrings(a.id, b.id))
  return JSON.stringify(sortObjectKeysDeep({ blocks, edges: sortedEdges }))
}

/**
 * Refuses the write when the stored graph is no longer the one the batch was
 * applied to. Runs under the workflow row lock, so a concurrent edit that
 * committed after the base read surfaces as a conflict instead of being
 * silently overwritten by a graph that never saw it.
 */
export async function assertStoredGraphUnchanged(
  workflowId: string,
  storedFingerprint: string,
  tx: DbOrTx
): Promise<void> {
  const current = await loadStoredGraph(workflowId, tx)
  if (storedGraphFingerprint(current) !== storedFingerprint) {
    throw new OrchestrationError(
      'conflict',
      'The workflow changed while these operations were being applied. Re-read it and retry.'
    )
  }
}

/**
 * Nudges only the blocks this batch touched, leaving the rest of the canvas
 * where the user put it. A layout failure is never fatal: the graph is already
 * correct, only its positions are less tidy.
 */
export function layoutChangedBlocks(
  workflowId: string,
  before: Pick<WorkflowState, 'blocks' | 'edges'>,
  after: Pick<WorkflowState, 'blocks' | 'edges'>
): Record<string, BlockState> {
  const { layoutBlockIds, resizedBlockIds, shiftSourceBlockIds } = getTargetedLayoutImpact({
    before,
    after,
  })
  if (
    layoutBlockIds.length === 0 &&
    resizedBlockIds.length === 0 &&
    shiftSourceBlockIds.length === 0
  ) {
    return after.blocks
  }
  try {
    transferBlockHeights(before.blocks, after.blocks)
    return applyTargetedLayout(after.blocks, after.edges, {
      changedBlockIds: layoutBlockIds,
      resizedBlockIds,
      shiftSourceBlockIds,
      horizontalSpacing: DEFAULT_HORIZONTAL_SPACING,
      verticalSpacing: DEFAULT_VERTICAL_SPACING,
      previousBlocks: before.blocks,
    }) as Record<string, BlockState>
  } catch (error) {
    logger.warn('Targeted autolayout failed, using supplied positions', {
      workflowId,
      error: toError(error).message,
    })
    return after.blocks
  }
}
