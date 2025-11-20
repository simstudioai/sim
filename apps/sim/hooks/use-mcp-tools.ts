/**
 * Hook for discovering and managing MCP tools
 *
 * This hook provides a unified interface for accessing MCP tools
 * using TanStack Query for optimal caching and performance
 */

import type React from 'react'
import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WrenchIcon } from 'lucide-react'
import { createLogger } from '@/lib/logs/console/logger'
import { createMcpToolId } from '@/lib/mcp/utils'
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
  getToolById: (toolId: string) => McpToolForUI | undefined
  getToolsByServer: (serverId: string) => McpToolForUI[]
}

/**
 * Hook for accessing MCP tools with TanStack Query
 * Provides backward-compatible API with the old useState-based implementation
 */
export function useMcpTools(workspaceId: string): UseMcpToolsResult {
  const queryClient = useQueryClient()

  // Use TanStack Query hook for data fetching with caching
  const { data: mcpToolsData = [], isLoading, error: queryError } = useMcpToolsQuery(workspaceId)

  // Transform raw tool data to UI-friendly format with memoization
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
      icon: WrenchIcon,
    }))
  }, [mcpToolsData])

  // Refresh tools by invalidating the query cache
  const refreshTools = useCallback(
    async (forceRefresh = false) => {
      if (!workspaceId) {
        logger.warn('Cannot refresh tools: no workspaceId provided')
        return
      }

      logger.info('Refreshing MCP tools', { forceRefresh, workspaceId })

      // Invalidate the query to trigger a refetch
      await queryClient.invalidateQueries({
        queryKey: mcpKeys.tools(workspaceId),
        refetchType: forceRefresh ? 'active' : 'all',
      })
    },
    [workspaceId, queryClient]
  )

  // Get tool by ID
  const getToolById = useCallback(
    (toolId: string): McpToolForUI | undefined => {
      return mcpTools.find((tool) => tool.id === toolId)
    },
    [mcpTools]
  )

  // Get all tools for a specific server
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
    getToolById,
    getToolsByServer,
  }
}

export function useMcpToolExecution(workspaceId: string) {
  const executeTool = useCallback(
    async (serverId: string, toolName: string, args: Record<string, any>) => {
      if (!workspaceId) {
        throw new Error('workspaceId is required for MCP tool execution')
      }

      logger.info(
        `Executing MCP tool ${toolName} on server ${serverId} in workspace ${workspaceId}`
      )

      const response = await fetch('/api/mcp/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          serverId,
          toolName,
          arguments: args,
          workspaceId,
        }),
      })

      if (!response.ok) {
        throw new Error(`Tool execution failed: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Tool execution failed')
      }

      return result.data
    },
    [workspaceId]
  )

  return { executeTool }
}
