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
      icon: WrenchIcon,
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

  const getToolById = useCallback(
    (toolId: string): McpToolForUI | undefined => {
      return mcpTools.find((tool) => tool.id === toolId)
    },
    [mcpTools]
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
