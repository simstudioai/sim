import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { McpClient } from '@/lib/mcp/client'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { resolveMcpConfigEnvVars } from '@/lib/mcp/resolve-config'
import type { McpTransport } from '@/lib/mcp/types'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpServerTestAPI')

export const dynamic = 'force-dynamic'

/**
 * Check if transport type requires a URL
 * All modern MCP connections use Streamable HTTP which requires a URL
 */
function isUrlBasedTransport(transport: McpTransport): boolean {
  return transport === 'streamable-http'
}

interface TestConnectionRequest {
  name: string
  transport: McpTransport
  url?: string
  headers?: Record<string, string>
  timeout?: number
  workspaceId: string
}

interface TestConnectionResult {
  success: boolean
  error?: string
  serverInfo?: {
    name: string
    version: string
  }
  negotiatedVersion?: string
  supportedCapabilities?: string[]
  toolCount?: number
  warnings?: string[]
}

/**
 * POST - Test connection to an MCP server before registering it
 */
export const POST = withMcpAuth('write')(
  async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      const body: TestConnectionRequest = getParsedBody(request) || (await request.json())

      logger.info(`[${requestId}] Testing MCP server connection:`, {
        name: body.name,
        transport: body.transport,
        url: body.url ? `${body.url.substring(0, 50)}...` : undefined, // Partial URL for security
        workspaceId,
      })

      if (!body.name || !body.transport) {
        return createMcpErrorResponse(
          new Error('Missing required fields: name and transport are required'),
          'Missing required fields',
          400
        )
      }

      if (isUrlBasedTransport(body.transport) && !body.url) {
        return createMcpErrorResponse(
          new Error('URL is required for HTTP-based transports'),
          'Missing required URL',
          400
        )
      }

      // Build initial config for resolution
      const initialConfig = {
        id: `test-${requestId}`,
        name: body.name,
        transport: body.transport,
        url: body.url,
        headers: body.headers || {},
        timeout: body.timeout || 10000,
        retries: 1, // Only one retry for tests
        enabled: true,
      }

      // Resolve env vars using shared utility (non-strict mode for testing)
      const { config: testConfig, missingVars } = await resolveMcpConfigEnvVars(
        initialConfig,
        userId,
        workspaceId,
        { strict: false }
      )

      if (missingVars.length > 0) {
        logger.warn(`[${requestId}] Some environment variables not found:`, { missingVars })
      }

      const testSecurityPolicy = {
        requireConsent: false,
        auditLevel: 'none' as const,
        maxToolExecutionsPerHour: 0,
      }

      const result: TestConnectionResult = { success: false }
      let client: McpClient | null = null

      try {
        client = new McpClient(testConfig, testSecurityPolicy)
        await client.connect()

        result.negotiatedVersion = client.getNegotiatedVersion()

        try {
          const tools = await client.listTools()
          result.toolCount = tools.length
          result.success = true
        } catch (toolError) {
          logger.warn(`[${requestId}] Connection established but could not list tools:`, toolError)
          result.success = false
          const errorMessage = toolError instanceof Error ? toolError.message : 'Unknown error'
          result.error = `Connection established but could not list tools: ${errorMessage}`
          result.warnings = result.warnings || []
          result.warnings.push(
            'Server connected but tool listing failed - connection may be incomplete'
          )
        }

        const clientVersionInfo = McpClient.getVersionInfo()
        if (result.negotiatedVersion !== clientVersionInfo.preferred) {
          result.warnings = result.warnings || []
          result.warnings.push(
            `Server uses protocol version '${result.negotiatedVersion}' instead of preferred '${clientVersionInfo.preferred}'`
          )
        }

        logger.info(`[${requestId}] MCP server test successful:`, {
          name: body.name,
          negotiatedVersion: result.negotiatedVersion,
          toolCount: result.toolCount,
          capabilities: result.supportedCapabilities,
        })
      } catch (error) {
        logger.warn(`[${requestId}] MCP server test failed:`, error)

        result.success = false
        if (error instanceof Error) {
          result.error = error.message
        } else {
          result.error = 'Unknown connection error'
        }
      } finally {
        if (client) {
          try {
            await client.disconnect()
          } catch (disconnectError) {
            logger.debug(`[${requestId}] Test client disconnect error (expected):`, disconnectError)
          }
        }
      }

      return createMcpSuccessResponse(result, result.success ? 200 : 400)
    } catch (error) {
      logger.error(`[${requestId}] Error testing MCP server connection:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to test server connection'),
        'Failed to test server connection',
        500
      )
    }
  }
)
