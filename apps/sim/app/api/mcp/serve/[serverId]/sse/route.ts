/**
 * MCP SSE/HTTP Endpoint
 *
 * Implements MCP protocol using the official @modelcontextprotocol/sdk
 * with a Next.js-compatible transport adapter.
 */

import { db } from '@sim/db'
import { workflowMcpServer } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { createLogger } from '@/lib/logs/console/logger'
import { createMcpSseStream, handleMcpRequest } from '@/lib/mcp/workflow-mcp-server'

const logger = createLogger('WorkflowMcpSSE')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RouteParams {
  serverId: string
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
 * Establishes a Server-Sent Events connection for MCP notifications
 */
export async function GET(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
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

    const apiKey =
      request.headers.get('X-API-Key') ||
      request.headers.get('Authorization')?.replace('Bearer ', '')

    // Create SSE stream using the SDK-based server
    const stream = createMcpSseStream({
      serverId,
      serverName: server.name,
      userId: auth.userId,
      workspaceId: server.workspaceId,
      apiKey,
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
 * POST - Handle MCP JSON-RPC messages
 * This is the primary endpoint for MCP protocol messages using the SDK
 */
export async function POST(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { serverId } = await params

  try {
    // Validate server
    const server = await validateServer(serverId)

    if (!server) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Server not found' },
        },
        { status: 404 }
      )
    }

    if (!server.isPublished) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Server is not published' },
        },
        { status: 403 }
      )
    }

    // Check authentication
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Unauthorized' },
        },
        { status: 401 }
      )
    }

    const apiKey =
      request.headers.get('X-API-Key') ||
      request.headers.get('Authorization')?.replace('Bearer ', '')

    // Handle the request using the SDK-based server
    return handleMcpRequest(
      {
        serverId,
        serverName: server.name,
        userId: auth.userId,
        workspaceId: server.workspaceId,
        apiKey,
      },
      request
    )
  } catch (error) {
    logger.error('Error handling MCP POST request:', error)
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'Internal error' },
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE - Handle session termination
 * MCP clients may send DELETE to end a session
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { serverId } = await params

  try {
    // Validate server exists
    const server = await validateServer(serverId)

    if (!server) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    // Check authentication
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
