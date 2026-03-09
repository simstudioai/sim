/**
 * Hook for discovering and managing MCP tools
 *
 * This hook provides a unified interface for accessing MCP tools
 * using TanStack Query for optimal caching and performance
 */

import type React from 'react'
import { useCallback, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { McpIcon } from '@/components/icons'
import { createMcpToolId } from '@/lib/mcp/shared'
import { mcpKeys, useMcpToolsQuery } from '@/hooks/queries/mcp'

const logger = createLogger('useMcpTools')

export interface McpToolForUI {
  id: string
  name: string
  description?: string
  serverId: string
  serverName: string
  type: 'mcp'
  inputSchema: any
  bgColor: string
  icon: React.ComponentType<any>
}

export interface UseMcpToolsResult {
  mcpTools: McpToolForUI[]
  isLoading: boolean
  error: string | null
  refreshTools: (forceRefresh?: boolean) => Promise<void>
  getToolsByServer: (serverId: string) => McpToolForUI[]
}

export function useMcpTools(workspaceId: string): UseMcpToolsResult {
  const queryClient = useQueryClient()

  const { data: mcpToolsData = [], isLoading, error: queryError } = useMcpToolsQuery(workspaceId)

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

  const refreshTools = useCallback(
    async (forceRefresh = false) => {
      if (!workspaceId) {
        logger.warn('Cannot refresh tools: no workspaceId provided')
        return
      }

      logger.info('Refreshing MCP tools', { forceRefresh, workspaceId })

      await queryClient.invalidateQueries({
        queryKey: mcpKeys.tools(workspaceId),
        refetchType: forceRefresh ? 'active' : 'all',
      })
    },
    [workspaceId, queryClient]
  )

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
