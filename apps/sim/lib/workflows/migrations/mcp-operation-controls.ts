import { isEqual } from 'es-toolkit'
import { normalizeMcpBlockValues, normalizeMcpToolAttachments } from '@/lib/mcp/workflow-config'
import type { BlockState, SubBlockState } from '@/stores/workflows/workflow/types'

/** Upgrades saved MCP fields in workflow state; no database schema change is required. */
export function migrateMcpOperationControls(block: BlockState): BlockState {
  if (block.type === 'agent' || block.type === 'mothership') {
    const tools = block.subBlocks.tools
    if (!tools) return block
    const value = normalizeMcpToolAttachments(tools.value) as SubBlockState['value']
    if (isEqual(value, tools.value)) return block
    return { ...block, subBlocks: { ...block.subBlocks, tools: { ...tools, value } } }
  }
  if (block.type !== 'mcp') return block
  const saved = Object.fromEntries(
    Object.entries(block.subBlocks).map(([id, field]) => [id, field.value])
  )
  const { values, canonicalModes } = normalizeMcpBlockValues(saved, block.data?.canonicalModes)
  const subBlocks: BlockState['subBlocks'] = {}
  for (const [id, value] of Object.entries(values)) {
    const type =
      id === 'serverSelector'
        ? 'mcp-server-selector'
        : id === 'toolSelector'
          ? 'mcp-tool-selector'
          : id === 'operation'
            ? 'dropdown'
            : 'short-input'
    subBlocks[id] = {
      ...(block.subBlocks[id] ?? { id, type }),
      value: value as SubBlockState['value'],
    }
  }
  if (isEqual(block.subBlocks, subBlocks) && isEqual(block.data?.canonicalModes, canonicalModes))
    return block
  return { ...block, subBlocks, data: { ...block.data, canonicalModes } }
}
