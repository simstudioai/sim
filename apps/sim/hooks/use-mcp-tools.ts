/**
 * Hook for discovering and managing MCP tools
 *
 * This hook provides a unified interface for accessing MCP tools
 * alongside regular platform tools in the tool-input component
 */

import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WrenchIcon } from 'lucide-react'
import { createLogger } from '@/lib/logs/console/logger'
import type { McpTool } from '@/lib/mcp/types'
import { useMcpServersStore } from '@/stores/mcp-servers/store'

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
  icon: React.ComponentType<any> // React component for MCP tools
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
  const [mcpTools, setMcpTools] = useState<McpToolForUI[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Subscribe to server changes to refresh tools when servers are modified
  const servers = useMcpServersStore((state) => state.servers)

  // Track the last fingerprint we processed to prevent infinite loops
  const lastProcessedFingerprintRef = useRef<string>('')

  // Create a stable server fingerprint to detect meaningful changes
  const serversFingerprint = useMemo(() => {
    return servers
      .filter((s) => s.enabled && !s.deletedAt) // Only consider active servers
      .map((s) => `${s.id}-${s.enabled}-${s.updatedAt}`)
      .sort()
      .join('|')
  }, [servers])

  const refreshTools = useCallback(
    async (forceRefresh = false) => {
      setIsLoading(true)
      setError(null)

      try {
        logger.info('Discovering MCP tools', { forceRefresh, workspaceId })

        const response = await fetch(
          `/api/mcp/tools/discover?workspaceId=${workspaceId}&refresh=${forceRefresh}`
        )

        if (!response.ok) {
          throw new Error(`Failed to discover MCP tools: ${response.status} ${response.statusText}`)
        }

        const data = await response.json()

        if (!data.success) {
          throw new Error(data.error || 'Failed to discover MCP tools')
        }

        const tools = data.data.tools || []
        const transformedTools = tools.map((tool: McpTool) => ({
          id: `${tool.serverId}-${tool.name}`,
          name: tool.name,
          description: tool.description,
          serverId: tool.serverId,
          serverName: tool.serverName,
          type: 'mcp' as const,
          inputSchema: tool.inputSchema,
          bgColor: '#6366F1', // Indigo color to match MCP block
          icon: WrenchIcon, // Standard icon for MCP tools
        }))

        setMcpTools(transformedTools)

        logger.info(
          `Discovered ${transformedTools.length} MCP tools from ${data.data.byServer ? Object.keys(data.data.byServer).length : 0} servers`
        )
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to discover MCP tools'
        logger.error('Error discovering MCP tools:', err)
        setError(errorMessage)
        setMcpTools([]) // Clear tools on error
      } finally {
        setIsLoading(false)
      }
    },
    [workspaceId]
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

  // Initial load on mount
  useEffect(() => {
    refreshTools()
  }, []) // Remove refreshTools dependency

  // Refresh tools when servers change (added/removed/updated)
  useEffect(() => {
    // Skip if no active servers or we already processed this fingerprint
    if (!serversFingerprint || serversFingerprint === lastProcessedFingerprintRef.current) return

    logger.info('Active servers changed, refreshing MCP tools', {
      serverCount: servers.filter((s) => s.enabled && !s.deletedAt).length,
      fingerprint: serversFingerprint,
    })

    // Update the ref to track this fingerprint as processed
    lastProcessedFingerprintRef.current = serversFingerprint
    refreshTools()
  }, [serversFingerprint]) // Only watch for fingerprint changes

  // Auto-refresh every 5 minutes to keep tools up-to-date
  useEffect(() => {
    const interval = setInterval(
      () => {
        if (!isLoading) {
          refreshTools()
        }
      },
      5 * 60 * 1000
    ) // 5 minutes

    return () => clearInterval(interval)
  }, [isLoading]) // Remove refreshTools dependency

  return {
    mcpTools,
    isLoading,
    error,
    refreshTools,
    getToolById,
    getToolsByServer,
  }
}

/**
 * Hook for executing MCP tools
 *
 * This provides a consistent interface for executing MCP tools
 * that matches the existing tool execution patterns
 */
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

/**
 * Hook for MCP server management
 *
 * Provides functions to manage MCP server connections
 */
