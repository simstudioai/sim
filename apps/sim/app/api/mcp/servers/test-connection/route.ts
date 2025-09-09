import type { NextRequest } from 'next/server'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { McpClient } from '@/lib/mcp/client'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import type { McpServerConfig } from '@/lib/mcp/types'
import { validateMcpServerUrl } from '@/lib/mcp/url-validator'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpServerTestAPI')

export const dynamic = 'force-dynamic'

/**
 * Resolve environment variables in strings
 */
function resolveEnvVars(value: string, envVars: Record<string, string>): string {
  const envMatches = value.match(/\{\{([^}]+)\}\}/g)
  if (!envMatches) return value

  let resolvedValue = value
  for (const match of envMatches) {
    const envKey = match.slice(2, -2).trim()
    const envValue = envVars[envKey]

    if (envValue === undefined) {
      logger.warn(`Environment variable "${envKey}" not found in MCP server test`)
      continue
    }

    resolvedValue = resolvedValue.replace(match, envValue)
  }
  return resolvedValue
}

interface TestConnectionRequest {
  name: string
  transport: 'http' | 'sse' | 'streamable-http'
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

      // Validate required fields
      if (!body.name || !body.transport) {
        return createMcpErrorResponse(
          new Error('Missing required fields: name and transport are required'),
          'Missing required fields',
          400
        )
      }

      // Validate URL if provided
      if (
        (body.transport === 'http' ||
          body.transport === 'sse' ||
          body.transport === 'streamable-http') &&
        body.url
      ) {
        const urlValidation = validateMcpServerUrl(body.url)
        if (!urlValidation.isValid) {
          return createMcpErrorResponse(
            new Error(`Invalid MCP server URL: ${urlValidation.error}`),
            'Invalid server URL',
            400
          )
        }
        body.url = urlValidation.normalizedUrl
      }

      // Resolve environment variables in config
      let resolvedUrl = body.url
      let resolvedHeaders = body.headers || {}

      try {
        const envVars = await getEffectiveDecryptedEnv(userId, workspaceId)

        if (resolvedUrl) {
          resolvedUrl = resolveEnvVars(resolvedUrl, envVars)
        }

        const resolvedHeadersObj: Record<string, string> = {}
        for (const [key, value] of Object.entries(resolvedHeaders)) {
          resolvedHeadersObj[key] = resolveEnvVars(value, envVars)
        }
        resolvedHeaders = resolvedHeadersObj
      } catch (envError) {
        logger.warn(
          `[${requestId}] Failed to resolve environment variables, using raw values:`,
          envError
        )
      }

      // Create temporary server config for testing
      const testConfig: McpServerConfig = {
        id: `test-${requestId}`,
        name: body.name,
        transport: body.transport,
        url: resolvedUrl,
        headers: resolvedHeaders,
        timeout: body.timeout || 10000, // Shorter timeout for testing
        retries: 1, // Only one retry for tests
        enabled: true,
      }

      // Test security policy (restrictive for testing)
      const testSecurityPolicy = {
        requireConsent: false, // Skip consent for connection testing
        auditLevel: 'none' as const,
        maxToolExecutionsPerHour: 0, // Don't allow tool execution during tests
      }

      const result: TestConnectionResult = { success: false }
      let client: McpClient | null = null

      try {
        // Create and connect to the test client
        client = new McpClient(testConfig, testSecurityPolicy)
        await client.connect()

        // If we get here, connection was successful
        result.success = true
        result.negotiatedVersion = client.getNegotiatedVersion()

        // Try to discover tools (with timeout)
        try {
          const tools = await client.listTools()
          result.toolCount = tools.length
        } catch (toolError) {
          logger.warn(`[${requestId}] Could not list tools from test server:`, toolError)
          result.warnings = result.warnings || []
          result.warnings.push('Could not list tools from server')
        }

        // Check for version compatibility warnings
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
        // Always disconnect the test client
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
