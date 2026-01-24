/**
 * MCP Service - Clean stateless service for MCP operations
 */

import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { isTest } from '@/lib/core/config/feature-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { McpClient } from '@/lib/mcp/client'
import { resolveMcpConfigEnvVars } from '@/lib/mcp/resolve-config'
import {
  createMcpCacheAdapter,
  getMcpCacheType,
  type McpCacheStorageAdapter,
} from '@/lib/mcp/storage'
import type {
  McpServerConfig,
  McpServerStatusConfig,
  McpServerSummary,
  McpTool,
  McpToolCall,
  McpToolResult,
  McpTransport,
} from '@/lib/mcp/types'
import { MCP_CONSTANTS } from '@/lib/mcp/utils'

const logger = createLogger('McpService')

class McpService {
  private cacheAdapter: McpCacheStorageAdapter
  private readonly cacheTimeout = MCP_CONSTANTS.CACHE_TIMEOUT

  constructor() {
    this.cacheAdapter = createMcpCacheAdapter()
    logger.info(`MCP Service initialized with ${getMcpCacheType()} cache`)
  }

  /**
   * Dispose of the service and cleanup resources
   */
  dispose(): void {
    this.cacheAdapter.dispose()
    logger.info('MCP Service disposed')
  }

  /**
   * Resolve environment variables in server config.
   * Uses shared utility with strict mode (throws on missing vars).
   */
  private async resolveConfigEnvVars(
    config: McpServerConfig,
    userId: string,
    workspaceId?: string
  ): Promise<McpServerConfig> {
    const { config: resolvedConfig } = await resolveMcpConfigEnvVars(config, userId, workspaceId, {
      strict: true,
    })
    return resolvedConfig
  }

  /**
   * Get server configuration from database
   */
  private async getServerConfig(
    serverId: string,
    workspaceId: string
  ): Promise<McpServerConfig | null> {
    const [server] = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, serverId),
          eq(mcpServers.workspaceId, workspaceId),
          eq(mcpServers.enabled, true),
          isNull(mcpServers.deletedAt)
        )
      )
      .limit(1)

    if (!server) {
      return null
    }

    return {
      id: server.id,
      name: server.name,
      description: server.description || undefined,
      transport: 'streamable-http' as const,
      url: server.url || undefined,
      headers: (server.headers as Record<string, string>) || {},
      timeout: server.timeout || 30000,
      retries: server.retries || 3,
      enabled: server.enabled,
      createdAt: server.createdAt.toISOString(),
      updatedAt: server.updatedAt.toISOString(),
    }
  }

  /**
   * Get all enabled servers for a workspace
   */
  private async getWorkspaceServers(workspaceId: string): Promise<McpServerConfig[]> {
    const whereConditions = [
      eq(mcpServers.workspaceId, workspaceId),
      eq(mcpServers.enabled, true),
      isNull(mcpServers.deletedAt),
    ]

    const servers = await db
      .select()
      .from(mcpServers)
      .where(and(...whereConditions))

    return servers.map((server) => ({
      id: server.id,
      name: server.name,
      description: server.description || undefined,
      transport: server.transport as McpTransport,
      url: server.url || undefined,
      headers: (server.headers as Record<string, string>) || {},
      timeout: server.timeout || 30000,
      retries: server.retries || 3,
      enabled: server.enabled,
      createdAt: server.createdAt.toISOString(),
      updatedAt: server.updatedAt.toISOString(),
    }))
  }

  /**
   * Create and connect to an MCP client
   */
  private async createClient(config: McpServerConfig): Promise<McpClient> {
    const securityPolicy = {
      requireConsent: true,
      auditLevel: 'basic' as const,
      maxToolExecutionsPerHour: 1000,
      allowedOrigins: config.url ? [new URL(config.url).origin] : undefined,
    }

    const client = new McpClient(config, securityPolicy)
    await client.connect()
    return client
  }

  /**
   * Execute a tool on a specific server with retry logic for session errors.
   * Retries once on session-related errors (400, 404, session ID issues).
   */
  async executeTool(
    userId: string,
    serverId: string,
    toolCall: McpToolCall,
    workspaceId: string
  ): Promise<McpToolResult> {
    const requestId = generateRequestId()
    const maxRetries = 2

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        logger.info(
          `[${requestId}] Executing MCP tool ${toolCall.name} on server ${serverId} for user ${userId}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`
        )

        const config = await this.getServerConfig(serverId, workspaceId)
        if (!config) {
          throw new Error(`Server ${serverId} not found or not accessible`)
        }

        const resolvedConfig = await this.resolveConfigEnvVars(config, userId, workspaceId)
        const client = await this.createClient(resolvedConfig)

        try {
          const result = await client.callTool(toolCall)
          logger.info(`[${requestId}] Successfully executed tool ${toolCall.name}`)
          return result
        } finally {
          await client.disconnect()
        }
      } catch (error) {
        if (this.isSessionError(error) && attempt < maxRetries - 1) {
          logger.warn(
            `[${requestId}] Session error executing tool ${toolCall.name}, retrying (attempt ${attempt + 1}):`,
            error
          )
          await new Promise((resolve) => setTimeout(resolve, 100))
          continue
        }
        throw error
      }
    }

    throw new Error(`Failed to execute tool ${toolCall.name} after ${maxRetries} attempts`)
  }

  /**
   * Check if an error indicates a session-related issue that might be resolved by retry
   */
  private isSessionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    const lowerMessage = message.toLowerCase()
    return (
      lowerMessage.includes('session') ||
      lowerMessage.includes('400') ||
      lowerMessage.includes('404') ||
      lowerMessage.includes('no valid session')
    )
  }

  /**
   * Update server connection status after discovery attempt
   */
  private async updateServerStatus(
    serverId: string,
    workspaceId: string,
    success: boolean,
    error?: string,
    toolCount?: number
  ): Promise<void> {
    try {
      const [currentServer] = await db
        .select({ statusConfig: mcpServers.statusConfig })
        .from(mcpServers)
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .limit(1)

      const currentConfig: McpServerStatusConfig =
        (currentServer?.statusConfig as McpServerStatusConfig | null) ?? {
          consecutiveFailures: 0,
          lastSuccessfulDiscovery: null,
        }

      const now = new Date()

      if (success) {
        await db
          .update(mcpServers)
          .set({
            connectionStatus: 'connected',
            lastConnected: now,
            lastError: null,
            toolCount: toolCount ?? 0,
            lastToolsRefresh: now,
            statusConfig: {
              consecutiveFailures: 0,
              lastSuccessfulDiscovery: now.toISOString(),
            },
            updatedAt: now,
          })
          .where(eq(mcpServers.id, serverId))
      } else {
        const newFailures = currentConfig.consecutiveFailures + 1
        const isErrorState = newFailures >= MCP_CONSTANTS.MAX_CONSECUTIVE_FAILURES

        await db
          .update(mcpServers)
          .set({
            connectionStatus: isErrorState ? 'error' : 'disconnected',
            lastError: error || 'Unknown error',
            statusConfig: {
              consecutiveFailures: newFailures,
              lastSuccessfulDiscovery: currentConfig.lastSuccessfulDiscovery,
            },
            updatedAt: now,
          })
          .where(eq(mcpServers.id, serverId))

        if (isErrorState) {
          logger.warn(
            `Server ${serverId} marked as error after ${newFailures} consecutive failures`
          )
        }
      }
    } catch (err) {
      logger.error(`Failed to update server status for ${serverId}:`, err)
    }
  }

  /**
   * Discover tools from all workspace servers
   */
  async discoverTools(
    userId: string,
    workspaceId: string,
    forceRefresh = false
  ): Promise<McpTool[]> {
    const requestId = generateRequestId()

    const cacheKey = `workspace:${workspaceId}`

    try {
      if (!forceRefresh) {
        try {
          const cached = await this.cacheAdapter.get(cacheKey)
          if (cached) {
            logger.debug(`[${requestId}] Using cached tools for user ${userId}`)
            return cached.tools
          }
        } catch (error) {
          logger.warn(`[${requestId}] Cache read failed, proceeding with discovery:`, error)
        }
      }

      logger.info(`[${requestId}] Discovering MCP tools for workspace ${workspaceId}`)

      const servers = await this.getWorkspaceServers(workspaceId)

      if (servers.length === 0) {
        logger.info(`[${requestId}] No servers found for workspace ${workspaceId}`)
        return []
      }

      const allTools: McpTool[] = []
      const results = await Promise.allSettled(
        servers.map(async (config) => {
          const resolvedConfig = await this.resolveConfigEnvVars(config, userId, workspaceId)
          const client = await this.createClient(resolvedConfig)
          try {
            const tools = await client.listTools()
            logger.debug(
              `[${requestId}] Discovered ${tools.length} tools from server ${config.name}`
            )
            return { serverId: config.id, tools }
          } finally {
            await client.disconnect()
          }
        })
      )

      let failedCount = 0
      const statusUpdates: Promise<void>[] = []

      results.forEach((result, index) => {
        const server = servers[index]
        if (result.status === 'fulfilled') {
          allTools.push(...result.value.tools)
          statusUpdates.push(
            this.updateServerStatus(
              server.id!,
              workspaceId,
              true,
              undefined,
              result.value.tools.length
            )
          )
        } else {
          failedCount++
          const errorMessage =
            result.reason instanceof Error ? result.reason.message : 'Unknown error'
          logger.warn(`[${requestId}] Failed to discover tools from server ${server.name}:`)
          statusUpdates.push(this.updateServerStatus(server.id!, workspaceId, false, errorMessage))
        }
      })

      Promise.allSettled(statusUpdates).catch((err) => {
        logger.error(`[${requestId}] Error updating server statuses:`, err)
      })

      if (failedCount === 0) {
        try {
          await this.cacheAdapter.set(cacheKey, allTools, this.cacheTimeout)
        } catch (error) {
          logger.warn(`[${requestId}] Cache write failed:`, error)
        }
      } else {
        logger.warn(
          `[${requestId}] Skipping cache due to ${failedCount} failed server(s) - will retry on next request`
        )
      }

      logger.info(
        `[${requestId}] Discovered ${allTools.length} tools from ${servers.length - failedCount}/${servers.length} servers`
      )
      return allTools
    } catch (error) {
      logger.error(`[${requestId}] Failed to discover MCP tools for user ${userId}:`, error)
      throw error
    }
  }

  /**
   * Discover tools from a specific server with retry logic for session errors.
   * Retries once on session-related errors (400, 404, session ID issues).
   */
  async discoverServerTools(
    userId: string,
    serverId: string,
    workspaceId: string
  ): Promise<McpTool[]> {
    const requestId = generateRequestId()
    const maxRetries = 2

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        logger.info(
          `[${requestId}] Discovering tools from server ${serverId} for user ${userId}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`
        )

        const config = await this.getServerConfig(serverId, workspaceId)
        if (!config) {
          throw new Error(`Server ${serverId} not found or not accessible`)
        }

        const resolvedConfig = await this.resolveConfigEnvVars(config, userId, workspaceId)
        const client = await this.createClient(resolvedConfig)

        try {
          const tools = await client.listTools()
          logger.info(`[${requestId}] Discovered ${tools.length} tools from server ${config.name}`)
          return tools
        } finally {
          await client.disconnect()
        }
      } catch (error) {
        if (this.isSessionError(error) && attempt < maxRetries - 1) {
          logger.warn(
            `[${requestId}] Session error discovering tools from server ${serverId}, retrying (attempt ${attempt + 1}):`,
            error
          )
          await new Promise((resolve) => setTimeout(resolve, 100))
          continue
        }
        throw error
      }
    }

    throw new Error(`Failed to discover tools from server ${serverId} after ${maxRetries} attempts`)
  }

  /**
   * Get server summaries for a user
   */
  async getServerSummaries(userId: string, workspaceId: string): Promise<McpServerSummary[]> {
    const requestId = generateRequestId()

    try {
      logger.info(`[${requestId}] Getting server summaries for workspace ${workspaceId}`)

      const servers = await this.getWorkspaceServers(workspaceId)
      const summaries: McpServerSummary[] = []

      for (const config of servers) {
        try {
          const resolvedConfig = await this.resolveConfigEnvVars(config, userId, workspaceId)
          const client = await this.createClient(resolvedConfig)
          const tools = await client.listTools()
          await client.disconnect()

          summaries.push({
            id: config.id,
            name: config.name,
            url: config.url,
            transport: config.transport,
            status: 'connected',
            toolCount: tools.length,
            lastSeen: new Date(),
            error: undefined,
          })
        } catch (error) {
          summaries.push({
            id: config.id,
            name: config.name,
            url: config.url,
            transport: config.transport,
            status: 'error',
            toolCount: 0,
            lastSeen: undefined,
            error: error instanceof Error ? error.message : 'Connection failed',
          })
        }
      }

      return summaries
    } catch (error) {
      logger.error(`[${requestId}] Failed to get server summaries for user ${userId}:`, error)
      throw error
    }
  }

  /**
   * Clear tool cache for a workspace or all workspaces
   */
  async clearCache(workspaceId?: string): Promise<void> {
    try {
      if (workspaceId) {
        const workspaceCacheKey = `workspace:${workspaceId}`
        await this.cacheAdapter.delete(workspaceCacheKey)
        logger.debug(`Cleared MCP tool cache for workspace ${workspaceId}`)
      } else {
        await this.cacheAdapter.clear()
        logger.debug('Cleared all MCP tool cache')
      }
    } catch (error) {
      logger.warn('Failed to clear cache:', error)
    }
  }
}

export const mcpService = new McpService()

/**
 * Setup process signal handlers for graceful shutdown
 */
export function setupMcpServiceCleanup() {
  if (isTest) {
    return
  }

  const cleanup = () => {
    mcpService.dispose()
  }

  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)

  return () => {
    process.removeListener('SIGTERM', cleanup)
    process.removeListener('SIGINT', cleanup)
  }
}
