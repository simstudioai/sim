import type { NextRequest } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { mcpService } from '@/lib/mcp/service'
import type { McpToolCall, McpToolResult } from '@/lib/mcp/types'
import {
  categorizeError,
  createMcpErrorResponse,
  createMcpSuccessResponse,
  MCP_CONSTANTS,
  validateStringParam,
} from '@/lib/mcp/utils'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('McpToolExecutionAPI')

export const dynamic = 'force-dynamic'

/**
 * POST - Execute a tool on an MCP server
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await checkHybridAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Authentication failed: ${auth.error}`)
      return createMcpErrorResponse(
        new Error(auth.error || 'Authentication required'),
        'Authentication failed',
        401
      )
    }

    const userId = auth.userId

    const body = await request.json()

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

    const { serverId, toolName, arguments: args, workspaceId } = body

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
      `[${requestId}] Executing tool ${toolName} on server ${serverId} for user ${userId}${workspaceId ? ` in workspace ${workspaceId}` : ''}`
    )

    let tool = null
    try {
      const tools = await mcpService.discoverServerTools(userId, serverId, workspaceId, false) // Use cache
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
      return createMcpErrorResponse(transformedResult, 'Tool execution failed', 400)
    }
    logger.info(`[${requestId}] Successfully executed tool ${toolName} on server ${serverId}`)
    return createMcpSuccessResponse(transformedResult)
  } catch (error) {
    logger.error(`[${requestId}] Error executing MCP tool:`, error)

    const { message, status } = categorizeError(error)
    return createMcpErrorResponse(new Error(message), 'Tool execution failed', status)
  }
}

/**
 * Validate tool arguments against schema
 */
function validateToolArguments(tool: any, args: any): string | null {
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
      if (propValue !== undefined) {
        const expectedType = (propSchema as any).type
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
function transformToolResult(result: McpToolResult): any {
  if (result.isError) {
    return {
      success: false,
      error: result.content?.[0]?.text || 'Tool execution failed',
      output: null,
    }
  }

  return {
    success: true,
    output: result,
  }
}
