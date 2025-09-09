/**
 * MCP Service - Clean stateless service for MCP operations
 */

import { and, eq, isNull } from 'drizzle-orm'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { McpClient } from '@/lib/mcp/client'
import type {
  McpServerConfig,
  McpServerSummary,
  McpTool,
  McpToolCall,
  McpToolResult,
} from '@/lib/mcp/types'
import { MCP_CONSTANTS } from '@/lib/mcp/utils'
import { generateRequestId } from '@/lib/utils'
import { db } from '@/db'
import { mcpServers } from '@/db/schema'

const logger = createLogger('McpService')

interface ToolCache {
  tools: McpTool[]
  expiry: Date
}

class McpService {
  private toolCache = new Map<string, ToolCache>()
  private readonly cacheTimeout = MCP_CONSTANTS.CACHE_TIMEOUT

  /**
   * Resolve environment variables in strings
   */
  private resolveEnvVars(value: string, envVars: Record<string, string>): string {
    const envMatches = value.match(/\{\{([^}]+)\}\}/g)
    if (!envMatches) return value

    let resolvedValue = value
    const missingVars: string[] = []

    for (const match of envMatches) {
      const envKey = match.slice(2, -2).trim()
      const envValue = envVars[envKey]

      if (envValue === undefined) {
        missingVars.push(envKey)
        continue
      }

      resolvedValue = resolvedValue.replace(match, envValue)
    }

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required environment variable${missingVars.length > 1 ? 's' : ''}: ${missingVars.join(', ')}. ` +
          `Please set ${missingVars.length > 1 ? 'these variables' : 'this variable'} in your workspace or personal environment settings.`
      )
    }

    return resolvedValue
  }

  /**
   * Resolve environment variables in server config
   */
  private async resolveConfigEnvVars(
    config: McpServerConfig,
    userId: string,
    workspaceId?: string
  ): Promise<McpServerConfig> {
    try {
      const envVars = await getEffectiveDecryptedEnv(userId, workspaceId)

      const resolvedConfig = { ...config }

      if (resolvedConfig.url) {
        resolvedConfig.url = this.resolveEnvVars(resolvedConfig.url, envVars)
      }

      if (resolvedConfig.headers) {
        const resolvedHeaders: Record<string, string> = {}
        for (const [key, value] of Object.entries(resolvedConfig.headers)) {
          resolvedHeaders[key] = this.resolveEnvVars(value, envVars)
        }
        resolvedConfig.headers = resolvedHeaders
      }

      return resolvedConfig
    } catch (error) {
      logger.error('Failed to resolve environment variables for MCP server config:', error)
      return config
    }
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
      transport: server.transport as 'http' | 'sse',
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
      transport: server.transport as 'http' | 'sse',
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
   * Create and connect to an MCP client with security policy
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
   * Execute a tool on a specific server
   */
  async executeTool(
    userId: string,
    serverId: string,
    toolCall: McpToolCall,
    workspaceId?: string
  ): Promise<McpToolResult> {
    const requestId = generateRequestId()

    try {
      logger.info(
        `[${requestId}] Executing MCP tool ${toolCall.name} on server ${serverId} for user ${userId}`
      )

      if (!workspaceId) {
        throw new Error('workspaceId is required for MCP tool execution')
      }

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
      logger.error(
        `[${requestId}] Failed to execute tool ${toolCall.name} on server ${serverId}:`,
        error
      )
      throw error
    }
  }

  /**
   * Discover tools from all workspace servers
   */
  async discoverTools(
    userId: string,
    workspaceId?: string,
    forceRefresh = false
  ): Promise<McpTool[]> {
    const requestId = generateRequestId()

    if (!workspaceId) {
      throw new Error('workspaceId is required for MCP tool discovery')
    }

    const cacheKey = `workspace:${workspaceId}`

    try {
      if (!forceRefresh) {
        const cached = this.toolCache.get(cacheKey)
        if (cached && cached.expiry > new Date()) {
          logger.debug(`[${requestId}] Using cached tools for user ${userId}`)
          return cached.tools
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
            return tools
          } finally {
            await client.disconnect()
          }
        })
      )

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
    workspaceId?: string,
    _forceRefresh = false
  ): Promise<McpTool[]> {
    const requestId = generateRequestId()

    try {
      logger.info(`[${requestId}] Discovering tools from server ${serverId} for user ${userId}`)

      if (!workspaceId) {
        throw new Error('workspaceId is required for MCP server tool discovery')
      }

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
      logger.error(`[${requestId}] Failed to discover tools from server ${serverId}:`, error)
      throw error
    }
  }

  /**
   * Get server summaries for a user
   */
  async getServerSummaries(userId: string, workspaceId?: string): Promise<McpServerSummary[]> {
    const requestId = generateRequestId()

    try {
      if (!workspaceId) {
        throw new Error('workspaceId is required for MCP server summaries')
      }

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
  clearCache(workspaceId?: string): void {
    if (workspaceId) {
      const workspaceCacheKey = `workspace:${workspaceId}`
      this.toolCache.delete(workspaceCacheKey)
      logger.debug(`Cleared MCP tool cache for workspace ${workspaceId}`)
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
