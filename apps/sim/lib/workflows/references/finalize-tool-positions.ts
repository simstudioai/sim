import { isRecordLike } from '@sim/utils/object'
import { coerceObjectArray } from '@/lib/workflows/persistence/remap-internal-ids'
import { reindexCanonicalModesByPosition } from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import type { BlockState } from '@/stores/workflows/workflow/types'

/** Prunes unresolved tool placeholders after source-indexed overrides and reindexes canonical modes. */
export function finalizeBlockToolPositions(block: BlockState): void {
  for (const [key, field] of Object.entries(block.subBlocks)) {
    if (
      !getBlock(block.type)?.subBlocks.some(
        (definition) => definition.id === key && definition.type === 'tool-input'
      )
    )
      continue
    const { array, wasString } = coerceObjectArray(field.value)
    if (!array) continue
    const indices = new Map<number, number>()
    const tools = array.filter((tool, index) => {
      if (!isRecordLike(tool)) return false
      if (tool.type === 'custom-tool' && !tool.customToolId) return false
      if (
        (tool.type === 'mcp' || tool.type === 'mcp-server-advanced') &&
        (!isRecordLike(tool.params) || !tool.params.serverId)
      )
        return false
      if (tool.type === 'workflow_input' && (!isRecordLike(tool.params) || !tool.params.workflowId))
        return false
      indices.set(index, indices.size)
      return true
    })
    const canonicalModes = reindexCanonicalModesByPosition(indices, block.data?.canonicalModes)
    if (canonicalModes) block.data = { ...block.data, canonicalModes }
    field.value = (wasString ? JSON.stringify(tools) : tools) as typeof field.value
  }
}
