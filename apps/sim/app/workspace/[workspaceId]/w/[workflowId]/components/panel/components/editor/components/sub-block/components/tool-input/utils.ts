import type { StoredTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/types'
import type { BlockConfig } from '@/blocks/types'

const CORE_AGENT_TOOL_TYPES = new Set([
  'api',
  'webhook_request',
  'workflow',
  'workflow_input',
  'knowledge',
  'function',
  'table',
  'file_v5',
])

/**
 * Checks whether a registered block should appear in the agent tool picker.
 */
export function isAgentToolBlock(
  block: Pick<BlockConfig, 'category' | 'hideFromToolbar' | 'type'>
): boolean {
  return (
    !block.hideFromToolbar && (block.category === 'tools' || CORE_AGENT_TOOL_TYPES.has(block.type))
  )
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
