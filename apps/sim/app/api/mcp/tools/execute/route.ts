import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { mcpService } from '@/lib/mcp/service'
import type { McpTool, McpToolCall, McpToolResult } from '@/lib/mcp/types'
import {
  categorizeError,
  createMcpErrorResponse,
  createMcpSuccessResponse,
  MCP_CONSTANTS,
  validateStringParam,
} from '@/lib/mcp/utils'

const logger = createLogger('McpToolExecutionAPI')

export const dynamic = 'force-dynamic'

// Type definitions for improved type safety
interface SchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
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

/**
 * Type guard to safely check if a schema property has a type field
 */
function hasType(prop: unknown): prop is SchemaProperty {
  return typeof prop === 'object' && prop !== null && 'type' in prop
}

/**
 * POST - Execute a tool on an MCP server
 */
export const POST = withMcpAuth('read')(
  async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      const body = getParsedBody(request) || (await request.json())

      logger.info(`[${requestId}] MCP tool execution request received`, {
        hasAuthHeader: !!request.headers.get('authorization'),
        authHeaderType: request.headers.get('authorization')?.substring(0, 10),
        bodyKeys: Object.keys(body),
        serverId: body.serverId,
        toolName: body.toolName,
        hasWorkflowId: !!body.workflowId,
        workflowId: body.workflowId,
        userId: userId,
      })

      const { serverId, toolName, arguments: args } = body

      const serverIdValidation = validateStringParam(serverId, 'serverId')
      if (!serverIdValidation.isValid) {
        logger.warn(`[${requestId}] Invalid serverId: ${serverId}`)
        return createMcpErrorResponse(new Error(serverIdValidation.error), 'Invalid serverId', 400)
      }

      const toolNameValidation = validateStringParam(toolName, 'toolName')
      if (!toolNameValidation.isValid) {
        logger.warn(`[${requestId}] Invalid toolName: ${toolName}`)
        return createMcpErrorResponse(new Error(toolNameValidation.error), 'Invalid toolName', 400)
      }

      logger.info(
        `[${requestId}] Executing tool ${toolName} on server ${serverId} for user ${userId} in workspace ${workspaceId}`
      )

      let tool = null
      try {
        const tools = await mcpService.discoverServerTools(userId, serverId, workspaceId)
        tool = tools.find((t) => t.name === toolName)

        if (!tool) {
          return createMcpErrorResponse(
            new Error(
              `Tool ${toolName} not found on server ${serverId}. Available tools: ${tools.map((t) => t.name).join(', ')}`
            ),
            'Tool not found',
            404
          )
        }

        // Cast arguments to their expected types based on tool schema
        if (tool.inputSchema?.properties) {
          for (const [paramName, paramSchema] of Object.entries(tool.inputSchema.properties)) {
            const schema = paramSchema as any
            const value = args[paramName]

            if (value === undefined || value === null) {
              continue
            }

            // Cast numbers
            if (
              (schema.type === 'number' || schema.type === 'integer') &&
              typeof value === 'string'
            ) {
              const numValue =
                schema.type === 'integer' ? Number.parseInt(value) : Number.parseFloat(value)
              if (!Number.isNaN(numValue)) {
                args[paramName] = numValue
              }
            }
            // Cast booleans
            else if (schema.type === 'boolean' && typeof value === 'string') {
              if (value.toLowerCase() === 'true') {
                args[paramName] = true
              } else if (value.toLowerCase() === 'false') {
                args[paramName] = false
              }
            }
            // Cast arrays
            else if (schema.type === 'array' && typeof value === 'string') {
              const stringValue = value.trim()
              if (stringValue) {
                try {
                  // Try to parse as JSON first (handles ["item1", "item2"])
                  const parsed = JSON.parse(stringValue)
                  if (Array.isArray(parsed)) {
                    args[paramName] = parsed
                  } else {
                    // JSON parsed but not an array, wrap in array
                    args[paramName] = [parsed]
                  }
                } catch (error) {
                  // JSON parsing failed - treat as comma-separated if contains commas, otherwise single item
                  if (stringValue.includes(',')) {
                    args[paramName] = stringValue
                      .split(',')
                      .map((item) => item.trim())
                      .filter((item) => item)
                  } else {
                    // Single item - wrap in array since schema expects array
                    args[paramName] = [stringValue]
                  }
                }
              } else {
                // Empty string becomes empty array
                args[paramName] = []
              }
            }
          }
        }
      } catch (error) {
        logger.warn(
          `[${requestId}] Failed to discover tools for validation, proceeding anyway:`,
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
        arguments: args || {},
      }

      const result = await Promise.race([
        mcpService.executeTool(userId, serverId, toolCall, workspaceId),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Tool execution timeout')),
            MCP_CONSTANTS.EXECUTION_TIMEOUT
          )
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

      // Track MCP tool execution
      try {
        const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')
        trackPlatformEvent('platform.mcp.tool_executed', {
          'mcp.server_id': serverId,
          'mcp.tool_name': toolName,
          'mcp.execution_status': 'success',
          'workspace.id': workspaceId,
        })
      } catch (_e) {
        // Silently fail
      }

      return createMcpSuccessResponse(transformedResult)
    } catch (error) {
      logger.error(`[${requestId}] Error executing MCP tool:`, error)

      const { message, status } = categorizeError(error)
      return createMcpErrorResponse(new Error(message), message, status)
    }
  }
)

/**
 * Validate tool arguments against schema
 */
function validateToolArguments(tool: McpTool, args: Record<string, unknown>): string | null {
  if (!tool.inputSchema) {
    return null // No schema to validate against
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

/**
 * Transform MCP tool result to platform format
 */
function transformToolResult(result: McpToolResult): ToolExecutionResult {
  if (result.isError) {
    return {
      success: false,
      error: result.content?.[0]?.text || 'Tool execution failed',
    }
  }

  return {
    success: true,
    output: result,
  }
}
