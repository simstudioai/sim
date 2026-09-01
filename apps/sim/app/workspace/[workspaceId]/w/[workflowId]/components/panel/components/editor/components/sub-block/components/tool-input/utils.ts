import { stripVersionSuffix } from '@sim/utils/string'
import type { StoredTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/types'
import type { BlockConfig } from '@/blocks/types'

/**
 * Core blocks the agent tool picker offers even though they are not
 * `category: 'tools'`. Stored as BASE types and matched after stripping the
 * `_vN` suffix, so a superseded version never has to be re-listed here at
 * cutover time. Naming a specific version instead is what kept `table_v2` out
 * of the picker while the toolbar had already moved to it.
 */
const CORE_AGENT_TOOL_TYPES = new Set([
  'api',
  'webhook_request',
  'workflow',
  'workflow_input',
  'knowledge',
  'function',
  'table',
  'file',
])

/**
 * Checks whether a registered block should appear in the agent tool picker.
 *
 * The `hideFromToolbar` guard is what keeps older versions out: superseded
 * blocks carry it statically, and `getAllBlocks()` projects unrevealed
 * `preview` blocks into clones that carry it too.
 */
export function isAgentToolBlock(
  block: Pick<BlockConfig, 'category' | 'hideFromToolbar' | 'type'>
): boolean {
  if (block.hideFromToolbar) return false
  if (block.category === 'tools') return true
  return CORE_AGENT_TOOL_TYPES.has(stripVersionSuffix(block.type))
}

/**
 * Checks if an MCP tool is already selected.
 */
export function isMcpToolAlreadySelected(selectedTools: StoredTool[], mcpToolId: string): boolean {
  return selectedTools.some((tool) => tool.type === 'mcp' && tool.toolId === mcpToolId)
}

/**
 * Checks if a custom tool is already selected.
 */
export function isCustomToolAlreadySelected(
  selectedTools: StoredTool[],
  customToolId: string
): boolean {
  return selectedTools.some(
    (tool) => tool.type === 'custom-tool' && tool.customToolId === customToolId
  )
}

/**
 * Checks if a workflow is already selected.
 */
export function isWorkflowAlreadySelected(
  selectedTools: StoredTool[],
  workflowId: string
): boolean {
  return selectedTools.some(
    (tool) => tool.type === 'workflow_input' && tool.params?.workflowId === workflowId
  )
}
