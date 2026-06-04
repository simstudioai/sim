/**
 * Hook for discovering and managing MCP tools
 *
 * This hook provides a unified interface for accessing MCP tools
 * using TanStack Query for optimal caching and performance
 */

import type { ComponentType, SVGProps } from 'react'
import { useCallback, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { McpIcon } from '@/components/icons'
import { createMcpToolId } from '@/lib/mcp/shared'
import type { McpToolSchema } from '@/lib/mcp/types'
import { mcpKeys, useMcpToolsQuery } from '@/hooks/queries/mcp'

const logger = createLogger('useMcpTools')

export interface McpToolForUI {
  id: string
  name: string
  description?: string
  serverId: string
  serverName: string
  type: 'mcp'
  inputSchema: McpToolSchema
  bgColor: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

export interface UseMcpToolsResult {
  mcpTools: McpToolForUI[]
  isLoading: boolean
  error: string | null
  refreshTools: () => Promise<void>
  getToolsByServer: (serverId: string) => McpToolForUI[]
}

export function useMcpTools(workspaceId: string): UseMcpToolsResult {
  const queryClient = useQueryClient()

  const { data: mcpToolsData, isLoading, error: queryError } = useMcpToolsQuery(workspaceId)

  const mcpTools = useMemo<McpToolForUI[]>(() => {
    return mcpToolsData.map((tool) => ({
      id: createMcpToolId(tool.serverId, tool.name),
      name: tool.name,
      description: tool.description,
      serverId: tool.serverId,
      serverName: tool.serverName,
      type: 'mcp' as const,
      inputSchema: tool.inputSchema,
      bgColor: '#6366F1',
      icon: McpIcon,
    }))
  }, [mcpToolsData])

  // Soft refresh — invalidate per-server entries. For cache-bypass, use `useForceRefreshMcpTools`.
  const refreshTools = useCallback(async () => {
    if (!workspaceId) {
      logger.warn('Cannot refresh tools: no workspaceId provided')
      return
    }

    await queryClient.invalidateQueries({
      queryKey: mcpKeys.serverToolsWorkspace(workspaceId),
    })
  }, [workspaceId, queryClient])

  const getToolsByServer = useCallback(
    (serverId: string): McpToolForUI[] => {
      return mcpTools.filter((tool) => tool.serverId === serverId)
    },
    [mcpTools]
  )

  return {
    mcpTools,
    isLoading,
    error: queryError instanceof Error ? queryError.message : null,
    refreshTools,
    getToolsByServer,
  }
}
