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
import { mcpService } from '@/lib/mcp/service'
import { McpOauthAuthorizationRequiredError, type McpToolDiscoveryResponse } from '@/lib/mcp/types'
import { categorizeError, createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpToolDiscoveryAPI')
const MCP_REFRESH_DISCOVERY_CONCURRENCY = 5

export const dynamic = 'force-dynamic'

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
  withMcpAuth('read')(async (request: NextRequest, { userId, workspaceId, requestId }) => {
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
        ? await mcpService.discoverServerTools(userId, serverId, workspaceId, forceRefresh)
        : await mcpService.discoverTools(userId, workspaceId, forceRefresh)

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
        error instanceof UnauthorizedError
      ) {
        return createMcpErrorResponse(error, 'OAuth re-authorization required', 401)
      }
      logger.error(`[${requestId}] Error discovering MCP tools:`, error)
      const { message, status } = categorizeError(error)
      return createMcpErrorResponse(new Error(message), 'Failed to discover MCP tools', status)
    }
  })
)

export const POST = withRouteHandler(
  withMcpAuth('read')(async (request: NextRequest, { userId, workspaceId, requestId }) => {
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
          const tools = await mcpService.discoverServerTools(userId, serverId, workspaceId, true)
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
