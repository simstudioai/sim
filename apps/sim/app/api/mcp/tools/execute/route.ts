import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { mcpToolExecutionBodySchema } from '@/lib/api/contracts/mcp'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getExecutionTimeout } from '@/lib/core/execution-limits'
import type { SubscriptionPlan } from '@/lib/core/rate-limiter/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { SIM_VIA_HEADER } from '@/lib/execution/call-chain'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { mcpService } from '@/lib/mcp/service'
import type { McpTool, McpToolCall, McpToolResult } from '@/lib/mcp/types'
import { categorizeError, createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import {
  assertPermissionsAllowed,
  McpToolsNotAllowedError,
} from '@/ee/access-control/utils/permission-check'

const logger = createLogger('McpToolExecutionAPI')

export const dynamic = 'force-dynamic'

interface SchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
  description?: string
  enum?: unknown[]
  format?: string
  items?: SchemaProperty
  properties?: Record<string, SchemaProperty>
}

interface ToolExecutionResult {
  success: boolean
  output?: McpToolResult
  error?: string
}

function hasType(prop: unknown): prop is SchemaProperty {
  return typeof prop === 'object' && prop !== null && 'type' in prop
}

/**
 * POST - Execute a tool on an MCP server
 */
export const POST = withRouteHandler(
  withMcpAuth('read')(async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      const rawBody = getParsedBody(request) ?? (await request.json())
      const parsedBody = mcpToolExecutionBodySchema.safeParse(rawBody)

      if (!parsedBody.success) {
        return createMcpErrorResponse(parsedBody.error, 'Invalid request format', 400)
      }

      const body = parsedBody.data

      logger.info(`[${requestId}] MCP tool execution request received`, {
        hasAuthHeader: !!request.headers.get('authorization'),
        bodyKeys: Object.keys(body),
        serverId: body.serverId,
        toolName: body.toolName,
        hasWorkflowId: !!body.workflowId,
        workflowId: body.workflowId,
        userId: userId,
      })

      const { serverId, toolName, arguments: rawArgs } = body
      const args = rawArgs || {}

      try {
        await assertPermissionsAllowed({
          userId,
          workspaceId,
          toolKind: 'mcp',
        })
      } catch (err) {
        if (err instanceof McpToolsNotAllowedError) {
          return createMcpErrorResponse(err, err.message, 403)
        }
        throw err
      }

      logger.info(
        `[${requestId}] Executing tool ${toolName} on server ${serverId} for user ${userId} in workspace ${workspaceId}`
      )

      let tool: McpTool | null = null
      try {
        const tools = await mcpService.discoverServerTools(userId, serverId, workspaceId)
        tool = tools.find((t) => t.name === toolName) ?? null

        if (!tool) {
          logger.warn(`[${requestId}] Tool ${toolName} not found on server ${serverId}`, {
            availableTools: tools.map((t) => t.name),
          })
          return createMcpErrorResponse(
            new Error('Tool not found'),
            'Tool not found on the specified server',
            404
          )
        }

        if (tool.inputSchema?.properties) {
          for (const [paramName, paramSchema] of Object.entries(tool.inputSchema.properties)) {
            const schema = paramSchema as any
            const value = args[paramName]

            if (value === undefined || value === null) {
              continue
            }

            if (
              (schema.type === 'number' || schema.type === 'integer') &&
              typeof value === 'string'
            ) {
              const numValue =
                schema.type === 'integer' ? Number.parseInt(value) : Number.parseFloat(value)
              if (!Number.isNaN(numValue)) {
                args[paramName] = numValue
              }
            } else if (schema.type === 'boolean' && typeof value === 'string') {
              if (value.toLowerCase() === 'true') {
                args[paramName] = true
              } else if (value.toLowerCase() === 'false') {
                args[paramName] = false
              }
            } else if (schema.type === 'array' && typeof value === 'string') {
              const stringValue = value.trim()
              if (stringValue) {
                try {
                  const parsed = JSON.parse(stringValue)
                  if (Array.isArray(parsed)) {
                    args[paramName] = parsed
                  } else {
                    args[paramName] = [parsed]
                  }
                } catch {
                  if (stringValue.includes(',')) {
                    args[paramName] = stringValue
                      .split(',')
                      .map((item) => item.trim())
                      .filter((item) => item)
                  } else {
                    args[paramName] = [stringValue]
                  }
                }
              } else {
                args[paramName] = []
              }
            }
          }
        }
      } catch (error) {
        logger.warn(
          `[${requestId}] Failed to discover tools for validation, proceeding without schema`,
          error
        )
      }

      if (tool) {
        const validationError = validateToolArguments(tool, args)
        if (validationError) {
          logger.warn(`[${requestId}] Tool validation failed: ${validationError}`)
          return createMcpErrorResponse(
            new Error(`Invalid arguments for tool ${toolName}: ${validationError}`),
            'Invalid tool arguments',
            400
          )
        }
      }

      const toolCall: McpToolCall = {
        name: toolName,
        arguments: args,
      }

      const userSubscription = await getHighestPrioritySubscription(userId)
      const executionTimeout = getExecutionTimeout(
        userSubscription?.plan as SubscriptionPlan | undefined,
        'sync'
      )

      const simViaHeader = request.headers.get(SIM_VIA_HEADER)
      const extraHeaders: Record<string, string> = {}
      if (simViaHeader) {
        extraHeaders[SIM_VIA_HEADER] = simViaHeader
      }

      const result = await Promise.race([
        mcpService.executeTool(userId, serverId, toolCall, workspaceId, extraHeaders),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Tool execution timeout')), executionTimeout)
        ),
      ])

      const transformedResult = transformToolResult(result)

      if (result.isError) {
        logger.warn(`[${requestId}] Tool execution returned error for ${toolName} on ${serverId}`)
        return createMcpErrorResponse(
          transformedResult,
          transformedResult.error || 'Tool execution failed',
          400
        )
      }
      logger.info(`[${requestId}] Successfully executed tool ${toolName} on server ${serverId}`)

      try {
        const { PlatformEvents } = await import('@/lib/core/telemetry')
        PlatformEvents.mcpToolExecuted({
          serverId,
          toolName,
          status: 'success',
          workspaceId,
        })
      } catch {
        // Telemetry failure is non-critical
      }

      return createMcpSuccessResponse(transformedResult)
    } catch (error) {
      logger.error(`[${requestId}] Error executing MCP tool:`, error)

      const { message, status } = categorizeError(error)
      return createMcpErrorResponse(new Error(message), message, status)
    }
  })
)

function validateToolArguments(tool: McpTool, args: Record<string, unknown>): string | null {
  if (!tool.inputSchema) {
    return null
  }

  const schema = tool.inputSchema

  if (schema.required && Array.isArray(schema.required)) {
    for (const requiredProp of schema.required) {
      if (!(requiredProp in (args || {}))) {
        return `Missing required property: ${requiredProp}`
      }
    }
  }

  if (schema.properties && args) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const propValue = args[propName]
      if (propValue !== undefined && hasType(propSchema)) {
        const expectedType = propSchema.type
        const actualType = typeof propValue

        if (expectedType === 'string' && actualType !== 'string') {
          return `Property ${propName} must be a string`
        }
        if (expectedType === 'number' && actualType !== 'number') {
          return `Property ${propName} must be a number`
        }
        if (
          expectedType === 'integer' &&
          (actualType !== 'number' || !Number.isInteger(propValue))
        ) {
          return `Property ${propName} must be an integer`
        }
        if (expectedType === 'boolean' && actualType !== 'boolean') {
          return `Property ${propName} must be a boolean`
        }
        if (
          expectedType === 'object' &&
          (actualType !== 'object' || propValue === null || Array.isArray(propValue))
        ) {
          return `Property ${propName} must be an object`
        }
        if (expectedType === 'array' && !Array.isArray(propValue)) {
          return `Property ${propName} must be an array`
        }
      }
    }
  }

  return null
}

function transformToolResult(result: McpToolResult): ToolExecutionResult {
  if (result.isError) {
    const firstContent = Array.isArray(result.content) ? result.content[0] : undefined
    const errorText =
      firstContent && typeof firstContent === 'object' && typeof firstContent.text === 'string'
        ? firstContent.text
        : undefined

    return {
      success: false,
      error: errorText && errorText.trim().length > 0 ? errorText : 'Tool execution failed',
    }
  }

  return {
    success: true,
    output: result,
  }
}
