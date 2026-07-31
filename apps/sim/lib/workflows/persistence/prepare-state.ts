import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/sanitization/validation'
import { validateEdges } from '@/stores/workflows/workflow/edge-validation'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

export interface PreparedWorkflowState {
  blocks: Record<string, BlockState>
  edges: WorkflowState['edges']
  loops: ReturnType<typeof generateLoopBlocks>
  parallels: ReturnType<typeof generateParallelBlocks>
}

export interface PrepareWorkflowStateResult {
  state: PreparedWorkflowState
  /** Human-readable notes about what was dropped or rewritten, for logging. */
  warnings: string[]
}

/**
 * Normalizes a workflow graph into the exact shape the normalized tables expect,
 * shared by every server-side write path so they cannot drift apart.
 *
 * Callers today: `PUT /api/workflows/[id]/state` (the editor and the in-app zip
 * importer, which reaches it over HTTP) and `POST /api/v1/workflows/import`.
 *
 * The steps are order-dependent:
 * 1. Strip secrets from inline agent-tool definitions.
 * 2. Drop blocks missing `type`/`name` and backfill the columns the tables
 *    require, so a partial block cannot violate a NOT NULL constraint.
 * 3. Drop edges whose endpoints no longer resolve — `workflow_edges` has
 *    foreign keys onto `workflow_blocks`, so a dangling edge would otherwise
 *    abort the whole transaction with an opaque database error.
 * 4. Recompute loop and parallel containers from the surviving blocks, which
 *    are the canonical source for both.
 */
export function prepareWorkflowStateForPersistence(state: {
  blocks: Record<string, BlockState>
  edges: WorkflowState['edges']
}): PrepareWorkflowStateResult {
  const { blocks: sanitizedBlocks, warnings: sanitizationWarnings } = sanitizeAgentToolsInBlocks(
    state.blocks
  )

  const blocks: Record<string, BlockState> = {}
  for (const [blockId, block] of Object.entries(sanitizedBlocks)) {
    if (!block.type || !block.name) continue
    blocks[blockId] = {
      ...block,
      enabled: block.enabled !== undefined ? block.enabled : true,
      horizontalHandles: block.horizontalHandles !== undefined ? block.horizontalHandles : true,
      height: block.height !== undefined ? block.height : 0,
      subBlocks: block.subBlocks || {},
      outputs: block.outputs || {},
    }
  }

  const validatedEdges = validateEdges(state.edges, blocks)

  return {
    state: {
      blocks,
      edges: validatedEdges.valid,
      loops: generateLoopBlocks(blocks),
      parallels: generateParallelBlocks(blocks),
    },
    warnings: [
      ...sanitizationWarnings,
      ...validatedEdges.dropped.map(({ edge, reason }) => `Dropped edge "${edge.id}": ${reason}`),
    ],
  }
}
