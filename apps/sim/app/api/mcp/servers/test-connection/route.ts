import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { mcpServerTestBodySchema } from '@/lib/api/contracts/mcp'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { McpClient } from '@/lib/mcp/client'
import {
  McpDnsResolutionError,
  McpDomainNotAllowedError,
  McpSsrfError,
  validateMcpDomain,
  validateMcpServerSsrf,
} from '@/lib/mcp/domain-check'
import {
  mcpBodyReadErrorResponse,
  readMcpJsonBodyWithLimit,
  withMcpAuth,
} from '@/lib/mcp/middleware'
import { detectMcpAuthType } from '@/lib/mcp/oauth'
import { resolveMcpConfigEnvVars } from '@/lib/mcp/resolve-config'
import type { McpAuthType, McpTransport } from '@/lib/mcp/types'
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

interface TestConnectionResult {
  success: boolean
  error?: string
  authRequired?: boolean
  authType?: McpAuthType
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
 * Maps connection failures to allowlisted messages. Upstream response bodies
 * may echo configured credentials, so arbitrary error text must not reach API
 * responses or logs.
 */
function sanitizeConnectionError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unknown connection error'
  }

  const message = error.message.toLowerCase()
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'Connection timed out'
  }
  if (message.includes('401') || message.includes('unauthorized')) {
    return 'HTTP 401: Unauthorized'
  }
  if (message.includes('403') || message.includes('forbidden')) {
    return 'HTTP 403: Forbidden'
  }
  if (message.includes('enotfound') || message.includes('could not resolve')) {
    return 'MCP server hostname could not be resolved'
  }
  if (message.includes('econnrefused') || message.includes('connection refused')) {
    return 'Connection refused'
  }
  if (message.includes('certificate') || message.includes('tls') || message.includes('ssl')) {
    return 'TLS connection failed'
  }
  return 'Connection failed'
}

/**
 * POST - Test connection to an MCP server before registering it
 */
export const POST = withRouteHandler(
  withMcpAuth('write')(async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      const rawBody = await readMcpJsonBodyWithLimit(request)
      const parsedBody = mcpServerTestBodySchema.safeParse(rawBody)

      if (!parsedBody.success) {
        return createMcpErrorResponse(parsedBody.error, 'Invalid request format', 400)
      }

      const body = parsedBody.data

      logger.info(`[${requestId}] Testing MCP server connection:`, {
        name: body.name,
        transport: body.transport,
        url: body.url ? `${body.url.substring(0, 50)}...` : undefined, // Partial URL for security
        workspaceId,
      })

      if (isUrlBasedTransport(body.transport) && !body.url) {
        return createMcpErrorResponse(
          new Error('URL is required for HTTP-based transports'),
          'Missing required URL',
          400
        )
      }

      try {
        validateMcpDomain(body.url)
      } catch (e) {
        if (e instanceof McpDomainNotAllowedError) {
          return createMcpErrorResponse(e, e.message, 403)
        }
        throw e
      }

      try {
        // Initial pre-resolution check; the authoritative resolved IP is
        // captured after env-var resolution below and used to pin the
        // connection against DNS rebinding.
        await validateMcpServerSsrf(body.url)
      } catch (e) {
        if (e instanceof McpDnsResolutionError) {
          return createMcpErrorResponse(e, e.message, 502)
        }
        if (e instanceof McpSsrfError) {
          return createMcpErrorResponse(e, e.message, 403)
        }
        throw e
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

      // Re-validate domain and SSRF after env var resolution
      try {
        validateMcpDomain(testConfig.url)
      } catch (e) {
        if (e instanceof McpDomainNotAllowedError) {
          return createMcpErrorResponse(e, e.message, 403)
        }
        throw e
      }

      let resolvedIP: string | null
      try {
        resolvedIP = await validateMcpServerSsrf(testConfig.url)
      } catch (e) {
        if (e instanceof McpDnsResolutionError) {
          return createMcpErrorResponse(e, e.message, 502)
        }
        if (e instanceof McpSsrfError) {
          return createMcpErrorResponse(e, e.message, 403)
        }
        throw e
      }

      const testSecurityPolicy = {
        requireConsent: false,
        auditLevel: 'none' as const,
        maxToolExecutionsPerHour: 0,
      }

      const result: TestConnectionResult = { success: false }

      /** An explicit static Bearer token takes precedence over optional OAuth discovery. */
      const hasStaticBearerToken = Object.entries(testConfig.headers ?? {}).some(
        ([name, value]) =>
          name.toLowerCase() === 'authorization' && /^Bearer\s+\S+/i.test(value.trim())
      )
      if (hasStaticBearerToken) {
        result.authType = 'headers'
      } else if (testConfig.url) {
        const detectedAuthType = await detectMcpAuthType(testConfig.url, resolvedIP)
        if (detectedAuthType === 'oauth') {
          result.authRequired = true
          result.authType = 'oauth'
          return createMcpSuccessResponse(result, 200)
        }
        result.authType = detectedAuthType
      }

      let client: McpClient | null = null

      try {
        client = new McpClient({
          config: testConfig,
          securityPolicy: testSecurityPolicy,
          resolvedIP: resolvedIP ?? undefined,
        })
        await client.connect()

        result.negotiatedVersion = client.getNegotiatedVersion()

        try {
          const tools = await client.listTools()
          result.toolCount = tools.length
          result.success = true
        } catch {
          logger.warn(`[${requestId}] Connection established but could not list tools`)
          result.success = false
          result.error = 'Connection established but could not list tools'
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
        result.success = false
        result.error = sanitizeConnectionError(error)
        logger.warn(`[${requestId}] MCP server test failed`, { error: result.error })
      } finally {
        if (client) {
          try {
            await client.disconnect()
          } catch {
            logger.debug(`[${requestId}] Test client disconnect error (expected)`)
          }
        }
      }

      return createMcpSuccessResponse(result, result.success ? 200 : 400)
    } catch (error) {
      const bodyErrorResponse = mcpBodyReadErrorResponse(error, request)
      if (bodyErrorResponse) return bodyErrorResponse
      logger.error(`[${requestId}] Error testing MCP server connection:`, error)
      return createMcpErrorResponse(toError(error), 'Failed to test server connection', 500)
    }
  })
)
