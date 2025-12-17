import { db } from '@sim/db'
import { workflow, workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('WorkflowMcpServeAPI')

export const dynamic = 'force-dynamic'

interface RouteParams {
  serverId: string
}

/**
 * MCP JSON-RPC Request
 */
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

/**
 * MCP JSON-RPC Response
 */
interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/**
 * Create JSON-RPC success response
 */
function createJsonRpcResponse(id: string | number, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  }
}

/**
 * Create JSON-RPC error response
 */
function createJsonRpcError(
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  }
}

/**
 * Validate that the server exists and is published
 */
async function validateServer(serverId: string) {
  const [server] = await db
    .select({
      id: workflowMcpServer.id,
      name: workflowMcpServer.name,
      workspaceId: workflowMcpServer.workspaceId,
      isPublished: workflowMcpServer.isPublished,
    })
    .from(workflowMcpServer)
    .where(eq(workflowMcpServer.id, serverId))
    .limit(1)

  return server
}

/**
 * GET - Server info and capabilities (MCP initialize)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> }
) {
  const { serverId } = await params

  try {
    const server = await validateServer(serverId)

    if (!server) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    if (!server.isPublished) {
      return NextResponse.json({ error: 'Server is not published' }, { status: 403 })
    }

    // Return server capabilities
    return NextResponse.json({
      name: server.name,
      version: '1.0.0',
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      instructions: `This MCP server exposes workflow tools from Sim Studio. Each tool executes a deployed workflow.`,
    })
  } catch (error) {
    logger.error('Error getting MCP server info:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST - Handle MCP JSON-RPC requests
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> }
) {
  const { serverId } = await params

  try {
    // Validate server
    const server = await validateServer(serverId)

    if (!server) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    if (!server.isPublished) {
      return NextResponse.json({ error: 'Server is not published' }, { status: 403 })
    }

    // Authenticate the request
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse JSON-RPC request
    const body = await request.json()
    const rpcRequest = body as JsonRpcRequest

    if (rpcRequest.jsonrpc !== '2.0' || !rpcRequest.method) {
      return NextResponse.json(
        createJsonRpcError(rpcRequest?.id || 0, -32600, 'Invalid Request'),
        { status: 400 }
      )
    }

    // Handle different MCP methods
    switch (rpcRequest.method) {
      case 'initialize':
        return NextResponse.json(
          createJsonRpcResponse(rpcRequest.id, {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: server.name,
              version: '1.0.0',
            },
          })
        )

      case 'tools/list':
        return handleToolsList(rpcRequest, serverId)

      case 'tools/call': {
        // Get the API key from the request to forward to the workflow execute call
        const apiKey = request.headers.get('X-API-Key') || request.headers.get('Authorization')?.replace('Bearer ', '')
        return handleToolsCall(rpcRequest, serverId, auth.userId, server.workspaceId, apiKey)
      }

      case 'ping':
        return NextResponse.json(createJsonRpcResponse(rpcRequest.id, {}))

      default:
        return NextResponse.json(
          createJsonRpcError(rpcRequest.id, -32601, `Method not found: ${rpcRequest.method}`),
          { status: 404 }
        )
    }
  } catch (error) {
    logger.error('Error handling MCP request:', error)
    return NextResponse.json(
      createJsonRpcError(0, -32603, 'Internal error'),
      { status: 500 }
    )
  }
}

/**
 * Handle tools/list method
 */
async function handleToolsList(
  rpcRequest: JsonRpcRequest,
  serverId: string
): Promise<NextResponse> {
  try {
    const tools = await db
      .select({
        id: workflowMcpTool.id,
        toolName: workflowMcpTool.toolName,
        toolDescription: workflowMcpTool.toolDescription,
        parameterSchema: workflowMcpTool.parameterSchema,
        isEnabled: workflowMcpTool.isEnabled,
        workflowId: workflowMcpTool.workflowId,
      })
      .from(workflowMcpTool)
      .where(eq(workflowMcpTool.serverId, serverId))

    const mcpTools = tools
      .filter((tool) => tool.isEnabled)
      .map((tool) => ({
        name: tool.toolName,
        description: tool.toolDescription || `Execute workflow tool: ${tool.toolName}`,
        inputSchema: tool.parameterSchema || {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              description: 'Input data for the workflow',
            },
          },
        },
      }))

    return NextResponse.json(
      createJsonRpcResponse(rpcRequest.id, { tools: mcpTools })
    )
  } catch (error) {
    logger.error('Error listing tools:', error)
    return NextResponse.json(
      createJsonRpcError(rpcRequest.id, -32603, 'Failed to list tools'),
      { status: 500 }
    )
  }
}

/**
 * Handle tools/call method
 */
async function handleToolsCall(
  rpcRequest: JsonRpcRequest,
  serverId: string,
  userId: string,
  workspaceId: string,
  apiKey?: string | null
): Promise<NextResponse> {
  try {
    const params = rpcRequest.params as { name: string; arguments?: Record<string, unknown> } | undefined

    if (!params?.name) {
      return NextResponse.json(
        createJsonRpcError(rpcRequest.id, -32602, 'Invalid params: tool name required'),
        { status: 400 }
      )
    }

    // Find the tool
    const [tool] = await db
      .select({
        id: workflowMcpTool.id,
        toolName: workflowMcpTool.toolName,
        workflowId: workflowMcpTool.workflowId,
        isEnabled: workflowMcpTool.isEnabled,
      })
      .from(workflowMcpTool)
      .where(eq(workflowMcpTool.serverId, serverId))
      .then((tools) => tools.filter((t) => t.toolName === params.name))

    if (!tool) {
      return NextResponse.json(
        createJsonRpcError(rpcRequest.id, -32602, `Tool not found: ${params.name}`),
        { status: 404 }
      )
    }

    if (!tool.isEnabled) {
      return NextResponse.json(
        createJsonRpcError(rpcRequest.id, -32602, `Tool is disabled: ${params.name}`),
        { status: 400 }
      )
    }

    // Verify workflow is still deployed
    const [workflowRecord] = await db
      .select({ id: workflow.id, isDeployed: workflow.isDeployed })
      .from(workflow)
      .where(eq(workflow.id, tool.workflowId))
      .limit(1)

    if (!workflowRecord || !workflowRecord.isDeployed) {
      return NextResponse.json(
        createJsonRpcError(rpcRequest.id, -32603, 'Workflow is not deployed'),
        { status: 400 }
      )
    }

    // Execute the workflow
    const baseUrl = getBaseUrl()
    const executeUrl = `${baseUrl}/api/workflows/${tool.workflowId}/execute`

    logger.info(`Executing workflow ${tool.workflowId} via MCP tool ${params.name}`)

    // Build headers for the internal execute call
    const executeHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    
    // Forward the API key for authentication
    if (apiKey) {
      executeHeaders['X-API-Key'] = apiKey
    }

    const executeResponse = await fetch(executeUrl, {
      method: 'POST',
      headers: executeHeaders,
      body: JSON.stringify({
        input: params.arguments || {},
        triggerType: 'mcp',
      }),
    })

    const executeResult = await executeResponse.json()

    if (!executeResponse.ok) {
      return NextResponse.json(
        createJsonRpcError(
          rpcRequest.id,
          -32603,
          executeResult.error || 'Workflow execution failed'
        ),
        { status: 500 }
      )
    }

    // Format response for MCP
    const content = [
      {
        type: 'text',
        text: JSON.stringify(executeResult.output || executeResult, null, 2),
      },
    ]

    return NextResponse.json(
      createJsonRpcResponse(rpcRequest.id, {
        content,
        isError: !executeResult.success,
      })
    )
  } catch (error) {
    logger.error('Error calling tool:', error)
    return NextResponse.json(
      createJsonRpcError(rpcRequest.id, -32603, 'Tool execution failed'),
      { status: 500 }
    )
  }
}
