import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { mcpToolDiscoveryQuerySchema, refreshMcpToolsBodySchema } from '@/lib/api/contracts/mcp'
import { validationErrorResponse } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  mcpBodyReadErrorResponse,
  readMcpJsonBodyWithLimit,
  withMcpAuth,
} from '@/lib/mcp/middleware'
import { McpOauthRedirectRequired } from '@/lib/mcp/oauth'
import { mcpService } from '@/lib/mcp/service'
import { McpOauthAuthorizationRequiredError, type McpToolDiscoveryResponse } from '@/lib/mcp/types'
import {
  categorizeError,
  createMcpErrorResponse,
  createMcpSuccessResponse,
  isMcpServerUnavailableError,
} from '@/lib/mcp/utils'

const logger = createLogger('McpToolDiscoveryAPI')
const MCP_REFRESH_DISCOVERY_CONCURRENCY = 5

export const dynamic = 'force-dynamic'

/**
 * Renders a discovery failure that is not an authorization problem.
 *
 * Discovery talks to a server the workspace registered, so a server that cannot be
 * reached, times out on connect or on `tools/list`, answers with a protocol or HTTP
 * error, or is cooling down after a recent failure is a fault of that server rather
 * than of Sim: it answers 422 (the request was valid; the dependency it names cannot
 * serve it), the status `oauth/start` answers when a server's authorization server
 * refuses it, and logs at warn. The v2 surface keeps its documented 503. Anything else
 * keeps {@link categorizeError}'s status and logs at error only when that status is a 5xx.
 */
function discoveryFailureResponse(requestId: string, error: unknown) {
  if (isMcpServerUnavailableError(error)) {
    logger.warn(`[${requestId}] MCP server unavailable for tool discovery`, {
      error: getErrorMessage(error),
    })
    return createMcpErrorResponse(error, 'Failed to discover MCP tools', 422)
  }
  const { message, status } = categorizeError(error)
  if (status >= 500) {
    logger.error(`[${requestId}] Error discovering MCP tools:`, error)
  } else {
    logger.warn(`[${requestId}] Failed to discover MCP tools`, {
      error: getErrorMessage(error),
      status,
    })
  }
  return createMcpErrorResponse(new Error(message), 'Failed to discover MCP tools', status)
}

async function settleWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R> | undefined> = new Array(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index]) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  })

  await Promise.all(workers)

  return results.map(
    (result) =>
      result ?? {
        status: 'rejected',
        reason: new Error('MCP refresh discovery task did not run'),
      }
  )
}

export const GET = withRouteHandler(
  withMcpAuth(
    'read',
    'mcp_tools.use'
  )(async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      const { searchParams } = new URL(request.url)
      const queryValidation = mcpToolDiscoveryQuerySchema.safeParse(
        Object.fromEntries(searchParams)
      )
      if (!queryValidation.success) return validationErrorResponse(queryValidation.error)
      const query = queryValidation.data
      const serverId = query.serverId
      const forceRefresh = query.refresh === 'true'

      logger.info(`[${requestId}] Discovering MCP tools`, { serverId, workspaceId, forceRefresh })

      const tools = serverId
        ? await mcpService.discoverServerTools(
            userId,
            serverId,
            workspaceId,
            forceRefresh ? 'force' : 'cache-aside'
          )
        : await mcpService.discoverTools(
            userId,
            workspaceId,
            forceRefresh ? 'force' : 'cache-aside'
          )

      const byServer: Record<string, number> = {}
      for (const tool of tools) {
        byServer[tool.serverId] = (byServer[tool.serverId] || 0) + 1
      }

      const responseData: McpToolDiscoveryResponse = {
        tools,
        totalCount: tools.length,
        byServer,
      }

      logger.info(
        `[${requestId}] Discovered ${tools.length} tools from ${Object.keys(byServer).length} servers`
      )
      return createMcpSuccessResponse(responseData)
    } catch (error) {
      if (
        error instanceof McpOauthAuthorizationRequiredError ||
        error instanceof McpOauthRedirectRequired ||
        error instanceof UnauthorizedError
      ) {
        return createMcpErrorResponse(error, 'OAuth re-authorization required', 401)
      }
      return discoveryFailureResponse(requestId, error)
    }
  })
)

export const POST = withRouteHandler(
  withMcpAuth(
    'read',
    'mcp_tools.use'
  )(async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      const rawBody = await readMcpJsonBodyWithLimit(request)
      const parsedBody = refreshMcpToolsBodySchema.safeParse(rawBody)

      if (!parsedBody.success) {
        return createMcpErrorResponse(parsedBody.error, 'Invalid request format', 400)
      }

      const { serverIds } = parsedBody.data

      logger.info(`[${requestId}] Refreshing tools for ${serverIds.length} servers`)

      const results = await settleWithConcurrency(
        serverIds,
        MCP_REFRESH_DISCOVERY_CONCURRENCY,
        async (serverId: string) => {
          const tools = await mcpService.discoverServerTools(userId, serverId, workspaceId, 'force')
          return { serverId, toolCount: tools.length }
        }
      )

      const successes: Array<{ serverId: string; toolCount: number }> = []
      const failures: Array<{ serverId: string; error: string }> = []

      results.forEach((result, index) => {
        const serverId = serverIds[index]
        if (result.status === 'fulfilled') {
          successes.push(result.value)
        } else {
          failures.push({
            serverId,
            error: getErrorMessage(result.reason, 'Unknown error'),
          })
        }
      })

      logger.info(`[${requestId}] Refresh completed: ${successes.length}/${serverIds.length}`)
      return createMcpSuccessResponse({
        refreshed: successes,
        failed: failures,
        summary: {
          total: serverIds.length,
          successful: successes.length,
          failed: failures.length,
        },
      })
    } catch (error) {
      const bodyErrorResponse = mcpBodyReadErrorResponse(error, request)
      if (bodyErrorResponse) return bodyErrorResponse
      if (
        error instanceof McpOauthAuthorizationRequiredError ||
        error instanceof UnauthorizedError
      ) {
        return createMcpErrorResponse(error, 'OAuth re-authorization required', 401)
      }
      logger.error(`[${requestId}] Error refreshing tool discovery:`, error)
      const { message, status } = categorizeError(error)
      return createMcpErrorResponse(new Error(message), 'Failed to refresh tool discovery', status)
    }
  })
)
