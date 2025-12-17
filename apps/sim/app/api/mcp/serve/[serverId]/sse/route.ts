import { db } from '@sim/db'
import { workflow, workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('WorkflowMcpSSE')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RouteParams {
  serverId: string
}

/**
 * MCP JSON-RPC Request/Response types
 */
interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: string | number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
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
 * GET - SSE endpoint for MCP protocol
 * This establishes a Server-Sent Events connection for bidirectional MCP communication
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> }
) {
  const { serverId } = await params

  try {
    // Validate server exists and is published
    const server = await validateServer(serverId)

    if (!server) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    if (!server.isPublished) {
      return NextResponse.json({ error: 'Server is not published' }, { status: 403 })
    }

    // Check authentication
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = auth.userId
    const workspaceId = server.workspaceId

    // Create SSE stream
    const encoder = new TextEncoder()
    let isStreamClosed = false

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: unknown) => {
          if (isStreamClosed) return
          try {
            const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
            controller.enqueue(encoder.encode(message))
          } catch {
            isStreamClosed = true
          }
        }

        // Send initial connection event
        sendEvent('open', { type: 'connection', status: 'connected' })

        // Send server capabilities
        sendEvent('message', {
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: server.name,
              version: '1.0.0',
            },
          },
        })

        // Keep connection alive with periodic pings
        const pingInterval = setInterval(() => {
          if (isStreamClosed) {
            clearInterval(pingInterval)
            return
          }
          sendEvent('ping', { timestamp: Date.now() })
        }, 30000)

        // Handle cleanup
        request.signal.addEventListener('abort', () => {
          isStreamClosed = true
          clearInterval(pingInterval)
          try {
            controller.close()
          } catch {
            // Stream already closed
          }
        })
      },

      cancel() {
        isStreamClosed = true
        logger.info(`SSE connection closed for server ${serverId}`)
      },
    })

    return new NextResponse(stream, {
      headers: {
        ...SSE_HEADERS,
        'X-MCP-Server-Id': serverId,
        'X-MCP-Server-Name': server.name,
      },
    })
  } catch (error) {
    logger.error('Error establishing SSE connection:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST - Handle messages sent to the SSE endpoint
 * This is used for the message channel in MCP streamable-http transport
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

    // Check authentication
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = auth.userId
    const workspaceId = server.workspaceId

    // Parse the incoming message
    const message = (await request.json()) as JsonRpcMessage

    if (message.jsonrpc !== '2.0') {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id: message.id || 0,
          error: { code: -32600, message: 'Invalid Request' },
        },
        { status: 400 }
      )
    }

    // Handle different methods
    switch (message.method) {
      case 'initialize':
        return NextResponse.json({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: server.name,
              version: '1.0.0',
            },
          },
        })

      case 'tools/list':
        return handleToolsList(message.id!, serverId)

      case 'tools/call': {
        // Get the API key from the request to forward to the workflow execute call
        const apiKey = request.headers.get('X-API-Key') || request.headers.get('Authorization')?.replace('Bearer ', '')
        return handleToolsCall(message, serverId, userId, workspaceId, apiKey)
      }

      case 'ping':
        return NextResponse.json({
          jsonrpc: '2.0',
          id: message.id,
          result: {},
        })

      default:
        return NextResponse.json({
          jsonrpc: '2.0',
          id: message.id || 0,
          error: { code: -32601, message: `Method not found: ${message.method}` },
        })
    }
  } catch (error) {
    logger.error('Error handling SSE POST:', error)
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: 0,
        error: { code: -32603, message: 'Internal error' },
      },
      { status: 500 }
    )
  }
}

/**
 * Handle tools/list method
 */
async function handleToolsList(
  id: string | number,
  serverId: string
): Promise<NextResponse> {
  const tools = await db
    .select({
      toolName: workflowMcpTool.toolName,
      toolDescription: workflowMcpTool.toolDescription,
      parameterSchema: workflowMcpTool.parameterSchema,
      isEnabled: workflowMcpTool.isEnabled,
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

  return NextResponse.json({
    jsonrpc: '2.0',
    id,
    result: { tools: mcpTools },
  })
}

/**
 * Handle tools/call method
 */
async function handleToolsCall(
  message: JsonRpcMessage,
  serverId: string,
  userId: string,
  workspaceId: string,
  apiKey?: string | null
): Promise<NextResponse> {
  const params = message.params as { name: string; arguments?: Record<string, unknown> } | undefined

  if (!params?.name) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: message.id || 0,
      error: { code: -32602, message: 'Invalid params: tool name required' },
    })
  }

  // Find the tool
  const tools = await db
    .select({
      toolName: workflowMcpTool.toolName,
      workflowId: workflowMcpTool.workflowId,
      isEnabled: workflowMcpTool.isEnabled,
    })
    .from(workflowMcpTool)
    .where(eq(workflowMcpTool.serverId, serverId))

  const tool = tools.find((t) => t.toolName === params.name)

  if (!tool) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: message.id || 0,
      error: { code: -32602, message: `Tool not found: ${params.name}` },
    })
  }

  if (!tool.isEnabled) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: message.id || 0,
      error: { code: -32602, message: `Tool is disabled: ${params.name}` },
    })
  }

  // Verify workflow is deployed
  const [workflowRecord] = await db
    .select({ id: workflow.id, isDeployed: workflow.isDeployed })
    .from(workflow)
    .where(eq(workflow.id, tool.workflowId))
    .limit(1)

  if (!workflowRecord || !workflowRecord.isDeployed) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: message.id || 0,
      error: { code: -32603, message: 'Workflow is not deployed' },
    })
  }

  // Execute the workflow
  const baseUrl = getBaseUrl()
  const executeUrl = `${baseUrl}/api/workflows/${tool.workflowId}/execute`

  logger.info(`Executing workflow ${tool.workflowId} via MCP SSE tool ${params.name}`)

  try {
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
      return NextResponse.json({
        jsonrpc: '2.0',
        id: message.id || 0,
        error: {
          code: -32603,
          message: executeResult.error || 'Workflow execution failed',
        },
      })
    }

    // Format response for MCP
    return NextResponse.json({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify(executeResult.output || executeResult, null, 2),
          },
        ],
        isError: !executeResult.success,
      },
    })
  } catch (error) {
    logger.error('Error executing workflow:', error)
    return NextResponse.json({
      jsonrpc: '2.0',
      id: message.id || 0,
      error: { code: -32603, message: 'Tool execution failed' },
    })
  }
}
