/**
 * MCP Serve Endpoint - Implements MCP protocol for workflow servers using SDK types.
 */

import {
  type CallToolResult,
  ErrorCode,
  type InitializeResult,
  isJSONRPCNotification,
  isJSONRPCRequest,
  type JSONRPCError,
  type JSONRPCMessage,
  type JSONRPCResponse,
  type ListToolsResult,
  type RequestId,
} from '@modelcontextprotocol/sdk/types.js'
import { db } from '@sim/db'
import { workflow, workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateInternalToken } from '@/lib/auth/internal'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('WorkflowMcpServeAPI')

export const dynamic = 'force-dynamic'

interface RouteParams {
  serverId: string
}

function createResponse(id: RequestId, result: unknown): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: result as JSONRPCResponse['result'],
  }
}

function createError(id: RequestId, code: ErrorCode | number, message: string): JSONRPCError {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  }
}

async function getServer(serverId: string) {
  const [server] = await db
    .select({
      id: workflowMcpServer.id,
      name: workflowMcpServer.name,
      workspaceId: workflowMcpServer.workspaceId,
      isPublic: workflowMcpServer.isPublic,
      createdBy: workflowMcpServer.createdBy,
    })
    .from(workflowMcpServer)
    .where(eq(workflowMcpServer.id, serverId))
    .limit(1)

  return server
}

export async function GET(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { serverId } = await params

  try {
    const server = await getServer(serverId)
    if (!server) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    return NextResponse.json({
      name: server.name,
      version: '1.0.0',
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
    })
  } catch (error) {
    logger.error('Error getting MCP server info:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { serverId } = await params

  try {
    const server = await getServer(serverId)
    if (!server) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    if (!server.isPublic) {
      const auth = await checkHybridAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const body = await request.json()
    const message = body as JSONRPCMessage

    if (isJSONRPCNotification(message)) {
      logger.info(`Received notification: ${message.method}`)
      return new NextResponse(null, { status: 202 })
    }

    if (!isJSONRPCRequest(message)) {
      return NextResponse.json(
        createError(0, ErrorCode.InvalidRequest, 'Invalid JSON-RPC message'),
        {
          status: 400,
        }
      )
    }

    const { id, method, params: rpcParams } = message
    const apiKey =
      request.headers.get('X-API-Key') ||
      request.headers.get('Authorization')?.replace('Bearer ', '')

    switch (method) {
      case 'initialize': {
        const result: InitializeResult = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: server.name, version: '1.0.0' },
        }
        return NextResponse.json(createResponse(id, result))
      }

      case 'ping':
        return NextResponse.json(createResponse(id, {}))

      case 'tools/list':
        return handleToolsList(id, serverId)

      case 'tools/call':
        return handleToolsCall(
          id,
          serverId,
          rpcParams as { name: string; arguments?: Record<string, unknown> },
          apiKey,
          server.isPublic ? server.createdBy : undefined
        )

      default:
        return NextResponse.json(
          createError(id, ErrorCode.MethodNotFound, `Method not found: ${method}`),
          {
            status: 404,
          }
        )
    }
  } catch (error) {
    logger.error('Error handling MCP request:', error)
    return NextResponse.json(createError(0, ErrorCode.InternalError, 'Internal error'), {
      status: 500,
    })
  }
}

async function handleToolsList(id: RequestId, serverId: string): Promise<NextResponse> {
  try {
    const tools = await db
      .select({
        toolName: workflowMcpTool.toolName,
        toolDescription: workflowMcpTool.toolDescription,
        parameterSchema: workflowMcpTool.parameterSchema,
      })
      .from(workflowMcpTool)
      .where(eq(workflowMcpTool.serverId, serverId))

    const result: ListToolsResult = {
      tools: tools.map((tool) => {
        const schema = tool.parameterSchema as {
          type?: string
          properties?: Record<string, unknown>
          required?: string[]
        } | null
        return {
          name: tool.toolName,
          description: tool.toolDescription || `Execute workflow: ${tool.toolName}`,
          inputSchema: {
            type: 'object' as const,
            properties: schema?.properties || {},
            ...(schema?.required && schema.required.length > 0 && { required: schema.required }),
          },
        }
      }),
    }

    return NextResponse.json(createResponse(id, result))
  } catch (error) {
    logger.error('Error listing tools:', error)
    return NextResponse.json(createError(id, ErrorCode.InternalError, 'Failed to list tools'), {
      status: 500,
    })
  }
}

async function handleToolsCall(
  id: RequestId,
  serverId: string,
  params: { name: string; arguments?: Record<string, unknown> } | undefined,
  apiKey?: string | null,
  publicServerOwnerId?: string
): Promise<NextResponse> {
  try {
    if (!params?.name) {
      return NextResponse.json(createError(id, ErrorCode.InvalidParams, 'Tool name required'), {
        status: 400,
      })
    }

    const [tool] = await db
      .select({
        toolName: workflowMcpTool.toolName,
        workflowId: workflowMcpTool.workflowId,
      })
      .from(workflowMcpTool)
      .where(and(eq(workflowMcpTool.serverId, serverId), eq(workflowMcpTool.toolName, params.name)))
      .limit(1)
    if (!tool) {
      return NextResponse.json(
        createError(id, ErrorCode.InvalidParams, `Tool not found: ${params.name}`),
        {
          status: 404,
        }
      )
    }

    const [wf] = await db
      .select({ isDeployed: workflow.isDeployed })
      .from(workflow)
      .where(eq(workflow.id, tool.workflowId))
      .limit(1)

    if (!wf?.isDeployed) {
      return NextResponse.json(
        createError(id, ErrorCode.InternalError, 'Workflow is not deployed'),
        {
          status: 400,
        }
      )
    }

    const executeUrl = `${getBaseUrl()}/api/workflows/${tool.workflowId}/execute`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (publicServerOwnerId) {
      const internalToken = await generateInternalToken(publicServerOwnerId)
      headers.Authorization = `Bearer ${internalToken}`
    } else if (apiKey) {
      headers['X-API-Key'] = apiKey
    }

    logger.info(`Executing workflow ${tool.workflowId} via MCP tool ${params.name}`)

    const response = await fetch(executeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: params.arguments || {}, triggerType: 'mcp' }),
      signal: AbortSignal.timeout(getMaxExecutionTimeout()),
    })

    const executeResult = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        createError(
          id,
          ErrorCode.InternalError,
          executeResult.error || 'Workflow execution failed'
        ),
        { status: 500 }
      )
    }

    const result: CallToolResult = {
      content: [
        { type: 'text', text: JSON.stringify(executeResult.output || executeResult, null, 2) },
      ],
      isError: executeResult.success === false,
    }

    return NextResponse.json(createResponse(id, result))
  } catch (error) {
    logger.error('Error calling tool:', error)
    return NextResponse.json(createError(id, ErrorCode.InternalError, 'Tool execution failed'), {
      status: 500,
    })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { serverId } = await params

  try {
    const server = await getServer(serverId)
    if (!server) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.info(`MCP session terminated for server ${serverId}`)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    logger.error('Error handling MCP DELETE request:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
