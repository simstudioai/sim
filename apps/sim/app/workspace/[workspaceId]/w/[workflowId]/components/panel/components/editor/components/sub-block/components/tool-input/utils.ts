import type { StoredTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/types'

/**
 * Checks if an MCP tool is already selected.
 */
export function isMcpToolAlreadySelected(selectedTools: StoredTool[], mcpToolId: string): boolean {
  return selectedTools.some((tool) => tool.type === 'mcp' && tool.toolId === mcpToolId)
}

/**
 * Checks if an MCP server is already selected (all tools mode).
 */
export function isMcpServerAlreadySelected(selectedTools: StoredTool[], serverId: string): boolean {
  return selectedTools.some(
    (tool) => tool.type === 'mcp-server' && tool.params?.serverId === serverId
  )
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
