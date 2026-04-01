import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import type { CustomToolDefinition } from '@/hooks/queries/custom-tools'
import { customToolsKeys } from '@/hooks/queries/utils/custom-tool-keys'

/**
 * Reads custom tools for a workspace directly from the React Query cache.
 */
export function getCustomTools(workspaceId: string): CustomToolDefinition[] {
  return (
    getQueryClient().getQueryData<CustomToolDefinition[]>(customToolsKeys.list(workspaceId)) ?? []
  )
}

/**
 * Resolves a custom tool from the cache by id or title.
 */
export function getCustomTool(
  identifier: string,
  workspaceId: string
): CustomToolDefinition | undefined {
  const tools = getCustomTools(workspaceId)
  return tools.find((tool) => tool.id === identifier || tool.title === identifier)
}
