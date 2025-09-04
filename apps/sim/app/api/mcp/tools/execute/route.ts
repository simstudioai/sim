import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { verifyInternalToken } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console/logger'
import { mcpService } from '@/lib/mcp/service'
import type { McpApiResponse, McpToolCall, McpToolResult } from '@/lib/mcp/types'

const logger = createLogger('McpToolExecutionAPI')

export const dynamic = 'force-dynamic'

/**
 * POST - Execute a tool on an MCP server
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()

    logger.info(`[${requestId}] MCP tool execution request received`, {
      hasAuthHeader: !!request.headers.get('authorization'),
      authHeaderType: request.headers.get('authorization')?.substring(0, 10),
      bodyKeys: Object.keys(body),
      serverId: body.serverId,
      toolName: body.toolName,
      hasWorkflowId: !!body.workflowId,
      workflowId: body.workflowId,
    })

    // Get authenticated user - support both session and internal token auth
    let userId: string | undefined

    // First try session authentication
    const session = await getSession()
    if (session?.user?.id) {
      userId = session.user.id
    } else {
      // If no session, check for internal token authentication
      const authHeader = request.headers.get('authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7)
        const isValidToken = await verifyInternalToken(token)
        if (isValidToken) {
          // For internal tokens, get the user ID from workflow context (like custom tools)
          const workflowId = body.workflowId
          if (!workflowId) {
            logger.warn(`[${requestId}] Missing workflowId for internal token authentication`)
            return NextResponse.json(
              { success: false, error: 'workflowId required for internal token authentication' },
              { status: 400 }
            )
          }

          // Get workflow owner as user context (same pattern as hybrid auth)
          const { eq } = await import('drizzle-orm')
          const { db } = await import('@/db')
          const { workflow } = await import('@/db/schema')

          const [workflowData] = await db
            .select({ userId: workflow.userId })
            .from(workflow)
            .where(eq(workflow.id, workflowId))
            .limit(1)

          if (!workflowData) {
            return NextResponse.json(
              { success: false, error: 'Workflow not found' },
              { status: 404 }
            )
          }

          userId = workflowData.userId
        }
      }
    }

    if (!userId) {
      logger.warn(`[${requestId}] Authentication failed - no userId found`)
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      )
    }
    const { serverId, toolName, arguments: args } = body

    // Validate required parameters
    if (!serverId || typeof serverId !== 'string') {
      logger.warn(`[${requestId}] Invalid serverId: ${serverId}`)
      return NextResponse.json(
        {
          success: false,
          error: 'serverId is required and must be a string',
        },
        { status: 400 }
      )
    }

    if (!toolName || typeof toolName !== 'string') {
      logger.warn(`[${requestId}] Invalid toolName: ${toolName}`)
      return NextResponse.json(
        {
          success: false,
          error: 'toolName is required and must be a string',
        },
        { status: 400 }
      )
    }

    logger.info(
      `[${requestId}] Executing tool ${toolName} on server ${serverId} for user ${userId}`
    )

    // First, discover the tool to validate arguments against its schema
    let tool = null
    try {
      const tools = await mcpService.discoverServerTools(userId, serverId, false) // Use cache
      tool = tools.find((t) => t.name === toolName)

      if (!tool) {
        return NextResponse.json(
          {
            success: false,
            error: `Tool ${toolName} not found on server ${serverId}. Available tools: ${tools.map((t) => t.name).join(', ')}`,
          },
          { status: 404 }
        )
      }
    } catch (error) {
      logger.warn(
        `[${requestId}] Failed to discover tools for validation, proceeding anyway:`,
        error
      )
    }

    // Validate arguments against tool schema if available
    if (tool) {
      const validationError = validateToolArguments(tool, args)
      if (validationError) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid arguments for tool ${toolName}: ${validationError}`,
          },
          { status: 400 }
        )
      }
    }

    const toolCall: McpToolCall = {
      name: toolName,
      arguments: args || {},
    }

    // Execute the tool with timeout
    const executionTimeout = 60000 // 60 seconds
    const result = await Promise.race([
      mcpService.executeTool(userId, serverId, toolCall),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Tool execution timeout')), executionTimeout)
      ),
    ])

    // Transform result for platform compatibility
    const transformedResult = transformToolResult(result)

    const response: McpApiResponse<any> = {
      success: !result.isError,
      data: transformedResult,
    }

    if (result.isError) {
      logger.warn(`[${requestId}] Tool execution returned error for ${toolName} on ${serverId}`)
    } else {
      logger.info(`[${requestId}] Successfully executed tool ${toolName} on server ${serverId}`)
    }

    return NextResponse.json(response, {
      status: result.isError ? 400 : 200,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error executing MCP tool:`, error)

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        return NextResponse.json(
          {
            success: false,
            error: 'Tool execution timed out',
          },
          { status: 408 }
        )
      }

      if (error.message.includes('not found') || error.message.includes('not accessible')) {
        return NextResponse.json(
          {
            success: false,
            error: error.message,
          },
          { status: 404 }
        )
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Tool execution failed',
      },
      { status: 500 }
    )
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

  // Check required properties
  if (schema.required && Array.isArray(schema.required)) {
    for (const requiredProp of schema.required) {
      if (!(requiredProp in (args || {}))) {
        return `Missing required property: ${requiredProp}`
      }
    }
  }

  // Basic type checking for properties
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

  // Extract text content as the primary output
  const textContent =
    result.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n') || ''

  return {
    success: true,
    output: {
      text: textContent,
      content: result.content || [],
    },
  }
}
