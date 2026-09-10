import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import { normalizeSavedMcpOperationName } from '@/lib/mcp/operation-policy'
import type { BlockState } from '@/stores/workflows/workflow/types'

/** Backfills existing standalone blocks before editor defaults can turn them into new restrictions. */
export function migrateMcpOperationControls(block: BlockState): BlockState {
  if (block.type !== 'mcp' || block.subBlocks.operationPolicy?.value != null) return block
  const values = Object.fromEntries(
    Object.entries(block.subBlocks).map(([id, field]) => [id, field.value])
  )
  const tool = normalizeSavedMcpOperationName(values)
  const migrated: BlockState = {
    ...block,
    subBlocks: {
      ...block.subBlocks,
      operationPolicy: { id: 'operationPolicy', type: 'mcp-operation-policy', value: null },
      operation: block.subBlocks.operation?.value
        ? block.subBlocks.operation
        : { id: 'operation', type: 'dropdown', value: 'run' },
      ...(typeof tool === 'string'
        ? { tool: { id: 'tool', type: 'mcp-tool-selector', value: tool } }
        : {}),
    },
  }
  return mergeSubblockStateWithValues(
    { [block.id]: migrated },
    { [block.id]: { operationPolicy: { mode: 'all' } } }
  )[block.id]
}
