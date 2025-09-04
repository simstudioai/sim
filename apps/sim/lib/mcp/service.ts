/**
 * MCP Service - Clean stateless service for MCP operations
 */

import { and, eq, isNull } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { mcpServers } from '@/db/schema'
import { McpClient } from './client'
import type {
  McpServerConfig,
  McpServerSummary,
  McpTool,
  McpToolCall,
  McpToolResult,
} from './types'

const logger = createLogger('McpService')

interface ToolCache {
  tools: McpTool[]
  expiry: Date
}

class McpService {
  private toolCache = new Map<string, ToolCache>()
  private readonly cacheTimeout = 5 * 60 * 1000 // 5 minutes

  /**
   * Get server configuration from database
   */
  private async getServerConfig(serverId: string, userId: string): Promise<McpServerConfig | null> {
    const [server] = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, serverId),
          eq(mcpServers.userId, userId),
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
      transport: server.transport as 'http' | 'sse' | 'stdio',
      url: server.url || undefined,
      headers: (server.headers as Record<string, string>) || {},
      command: server.command || undefined,
      args: server.args ? (server.args as string[]) : undefined,
      env: server.env ? (server.env as Record<string, string>) : undefined,
      timeout: server.timeout || 30000,
      retries: server.retries || 3,
      enabled: server.enabled,
      createdAt: server.createdAt.toISOString(),
      updatedAt: server.updatedAt.toISOString(),
    }
  }

  /**
   * Get all enabled servers for a user
   */
  private async getUserServers(userId: string, workspaceId?: string): Promise<McpServerConfig[]> {
    const whereConditions = [
      eq(mcpServers.userId, userId),
      eq(mcpServers.enabled, true),
      isNull(mcpServers.deletedAt),
    ]

    if (workspaceId) {
      whereConditions.push(eq(mcpServers.workspaceId, workspaceId))
    }

    const servers = await db
      .select()
      .from(mcpServers)
      .where(and(...whereConditions))

    return servers.map((server) => ({
      id: server.id,
      name: server.name,
      description: server.description || undefined,
      transport: server.transport as 'http' | 'sse' | 'stdio',
      url: server.url || undefined,
      headers: (server.headers as Record<string, string>) || {},
      command: server.command || undefined,
      args: server.args ? (server.args as string[]) : undefined,
      env: server.env ? (server.env as Record<string, string>) : undefined,
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
    const client = new McpClient(config)
    await client.connect()
    return client
  }

  /**
   * Execute a tool on a specific server
   */
  async executeTool(
    userId: string,
    serverId: string,
    toolCall: McpToolCall
  ): Promise<McpToolResult> {
    const requestId = crypto.randomUUID().slice(0, 8)

    try {
      logger.info(
        `[${requestId}] Executing MCP tool ${toolCall.name} on server ${serverId} for user ${userId}`
      )

      // Get server configuration
      const config = await this.getServerConfig(serverId, userId)
      if (!config) {
        throw new Error(`Server ${serverId} not found or not accessible`)
      }

      // Create client and execute
      const client = await this.createClient(config)

      try {
        const result = await client.callTool(toolCall)
        logger.info(`[${requestId}] Successfully executed tool ${toolCall.name}`)
        return result
      } finally {
        // Clean up connection
        await client.disconnect()
      }
    } catch (error) {
      logger.error(
        `[${requestId}] Failed to execute tool ${toolCall.name} on server ${serverId}:`,
        error
      )
      throw error
    }
  }

  /**
   * Discover tools from all user servers (with caching)
   */
  async discoverTools(
    userId: string,
    workspaceId?: string,
    forceRefresh = false
  ): Promise<McpTool[]> {
    const requestId = crypto.randomUUID().slice(0, 8)
    const cacheKey = `${userId}${workspaceId ? `:${workspaceId}` : ''}`

    try {
      // Check cache first
      if (!forceRefresh) {
        const cached = this.toolCache.get(cacheKey)
        if (cached && cached.expiry > new Date()) {
          logger.debug(`[${requestId}] Using cached tools for user ${userId}`)
          return cached.tools
        }
      }

      logger.info(`[${requestId}] Discovering MCP tools for user ${userId}`)

      // Get user servers
      const servers = await this.getUserServers(userId, workspaceId)

      if (servers.length === 0) {
        logger.info(`[${requestId}] No servers found for user ${userId}`)
        return []
      }

      // Discover tools from all servers
      const allTools: McpTool[] = []
      const results = await Promise.allSettled(
        servers.map(async (config) => {
          const client = await this.createClient(config)
          try {
            const tools = await client.listTools()
            logger.debug(
              `[${requestId}] Discovered ${tools.length} tools from server ${config.name}`
            )
            return tools
          } finally {
            await client.disconnect()
          }
        })
      )

      // Collect successful results
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          allTools.push(...result.value)
        } else {
          logger.warn(
            `[${requestId}] Failed to discover tools from server ${servers[index].name}:`,
            result.reason
          )
        }
      })

      // Cache results
      this.toolCache.set(cacheKey, {
        tools: allTools,
        expiry: new Date(Date.now() + this.cacheTimeout),
      })

      logger.info(
        `[${requestId}] Discovered ${allTools.length} tools from ${servers.length} servers`
      )
      return allTools
    } catch (error) {
      logger.error(`[${requestId}] Failed to discover MCP tools for user ${userId}:`, error)
      throw error
    }
  }

  /**
   * Discover tools from a specific server
   */
  async discoverServerTools(
    userId: string,
    serverId: string,
    _forceRefresh = false
  ): Promise<McpTool[]> {
    const requestId = crypto.randomUUID().slice(0, 8)

    try {
      logger.info(`[${requestId}] Discovering tools from server ${serverId} for user ${userId}`)

      // Get server configuration
      const config = await this.getServerConfig(serverId, userId)
      if (!config) {
        throw new Error(`Server ${serverId} not found or not accessible`)
      }

      // Create client and discover tools
      const client = await this.createClient(config)

      try {
        const tools = await client.listTools()
        logger.info(`[${requestId}] Discovered ${tools.length} tools from server ${config.name}`)
        return tools
      } finally {
        await client.disconnect()
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to discover tools from server ${serverId}:`, error)
      throw error
    }
  }

  /**
   * Get server summaries for a user
   */
  async getServerSummaries(userId: string, workspaceId?: string): Promise<McpServerSummary[]> {
    const requestId = crypto.randomUUID().slice(0, 8)

    try {
      logger.info(`[${requestId}] Getting server summaries for user ${userId}`)

      const servers = await this.getUserServers(userId, workspaceId)
      const summaries: McpServerSummary[] = []

      for (const config of servers) {
        try {
          // Test connection to get status
          const client = await this.createClient(config)
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
   * Clear tool cache for a user or all users
   */
  clearCache(userId?: string): void {
    if (userId) {
      // Clear all cache entries for this user
      for (const [key] of this.toolCache) {
        if (key.startsWith(userId)) {
          this.toolCache.delete(key)
        }
      }
      logger.debug(`Cleared MCP tool cache for user ${userId}`)
    } else {
      this.toolCache.clear()
      logger.debug('Cleared all MCP tool cache')
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const entries = Array.from(this.toolCache.entries())
    const activeEntries = entries.filter(([, cache]) => cache.expiry > new Date())

    return {
      totalEntries: entries.length,
      activeEntries: activeEntries.length,
      expiredEntries: entries.length - activeEntries.length,
    }
  }
}

// Export singleton instance
export const mcpService = new McpService()
