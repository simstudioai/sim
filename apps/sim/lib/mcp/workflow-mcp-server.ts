/**
 * Workflow MCP Server
 *
 * Creates an MCP server using the official @modelcontextprotocol/sdk
 * that exposes workflows as tools via a Next.js-compatible transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { db } from '@sim/db'
import { workflow, workflowMcpTool } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'
import { fileItemZodSchema } from '@/lib/mcp/workflow-tool-schema'

const logger = createLogger('WorkflowMcpServer')

/**
 * Convert stored JSON schema to Zod schema.
 * Uses fileItemZodSchema from workflow-tool-schema for file arrays.
 */
function jsonSchemaToZodShape(schema: Record<string, unknown> | null): z.ZodRawShape | undefined {
  if (!schema || schema.type !== 'object') {
    return undefined
  }

  const properties = schema.properties as
    | Record<string, { type: string; description?: string; items?: unknown }>
    | undefined
  if (!properties || Object.keys(properties).length === 0) {
    return undefined
  }

  const shape: z.ZodRawShape = {}
  const required = (schema.required as string[] | undefined) || []

  for (const [key, prop] of Object.entries(properties)) {
    let zodType: z.ZodTypeAny

    // Check if this array has items (file arrays have items.type === 'object')
    const hasObjectItems =
      prop.type === 'array' &&
      prop.items &&
      typeof prop.items === 'object' &&
      (prop.items as Record<string, unknown>).type === 'object'

    switch (prop.type) {
      case 'string':
        zodType = z.string()
        break
      case 'number':
        zodType = z.number()
        break
      case 'boolean':
        zodType = z.boolean()
        break
      case 'array':
        if (hasObjectItems) {
          // File arrays - use the shared file item schema
          zodType = z.array(fileItemZodSchema)
        } else {
          zodType = z.array(z.any())
        }
        break
      case 'object':
        zodType = z.record(z.any())
        break
      default:
        zodType = z.any()
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description)
    }

    if (!required.includes(key)) {
      zodType = zodType.optional()
    }

    shape[key] = zodType
  }

  return Object.keys(shape).length > 0 ? shape : undefined
}

interface WorkflowTool {
  id: string
  toolName: string
  toolDescription: string | null
  parameterSchema: Record<string, unknown> | null
  workflowId: string
  isEnabled: boolean
}

interface ServerContext {
  serverId: string
  serverName: string
  userId: string
  workspaceId: string
  apiKey?: string | null
}

/**
 * A simple transport for handling single request/response cycles in Next.js
 * This transport is designed for stateless request handling where each
 * request creates a new server instance.
 */
class NextJsTransport implements Transport {
  private responseMessage: JSONRPCMessage | null = null
  private resolveResponse: ((message: JSONRPCMessage) => void) | null = null

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  async start(): Promise<void> {
    // No-op for stateless transport
  }

  async close(): Promise<void> {
    this.onclose?.()
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.responseMessage = message
    this.resolveResponse?.(message)
  }

  /**
   * Injects a message into the transport as if it was received from the client
   */
  receiveMessage(message: JSONRPCMessage): void {
    this.onmessage?.(message)
  }

  /**
   * Waits for the server to send a response
   */
  waitForResponse(): Promise<JSONRPCMessage> {
    if (this.responseMessage) {
      return Promise.resolve(this.responseMessage)
    }
    return new Promise((resolve) => {
      this.resolveResponse = resolve
    })
  }
}

/**
 * Creates and configures an MCP server with workflow tools
 */
async function createConfiguredMcpServer(context: ServerContext): Promise<McpServer> {
  const { serverId, serverName, apiKey } = context

  // Create the MCP server using the SDK
  const server = new McpServer({
    name: serverName,
    version: '1.0.0',
  })

  // Load tools from the database
  const tools = await db
    .select({
      id: workflowMcpTool.id,
      toolName: workflowMcpTool.toolName,
      toolDescription: workflowMcpTool.toolDescription,
      parameterSchema: workflowMcpTool.parameterSchema,
      workflowId: workflowMcpTool.workflowId,
      isEnabled: workflowMcpTool.isEnabled,
    })
    .from(workflowMcpTool)
    .where(eq(workflowMcpTool.serverId, serverId))

  // Register each enabled tool
  for (const tool of tools.filter((t) => t.isEnabled)) {
    const zodSchema = jsonSchemaToZodShape(tool.parameterSchema as Record<string, unknown> | null)

    if (zodSchema) {
      // Tool with parameters - callback receives (args, extra)
      server.tool(
        tool.toolName,
        tool.toolDescription || `Execute workflow: ${tool.toolName}`,
        zodSchema,
        async (args) => {
          return executeWorkflowTool(tool as WorkflowTool, args, apiKey)
        }
      )
    } else {
      // Tool without parameters - callback only receives (extra)
      server.tool(
        tool.toolName,
        tool.toolDescription || `Execute workflow: ${tool.toolName}`,
        async () => {
          return executeWorkflowTool(tool as WorkflowTool, {}, apiKey)
        }
      )
    }
  }

  logger.info(
    `Created MCP server "${serverName}" with ${tools.filter((t) => t.isEnabled).length} tools`
  )

  return server
}

/**
 * Executes a workflow tool and returns the result
 */
async function executeWorkflowTool(
  tool: WorkflowTool,
  args: Record<string, unknown>,
  apiKey?: string | null
): Promise<{
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}> {
  logger.info(`Executing workflow ${tool.workflowId} via MCP tool ${tool.toolName}`)

  try {
    // Verify workflow is deployed
    const [workflowRecord] = await db
      .select({ id: workflow.id, isDeployed: workflow.isDeployed })
      .from(workflow)
      .where(eq(workflow.id, tool.workflowId))
      .limit(1)

    if (!workflowRecord || !workflowRecord.isDeployed) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Workflow is not deployed' }) }],
        isError: true,
      }
    }

    // Execute the workflow
    const baseUrl = getBaseUrl()
    const executeUrl = `${baseUrl}/api/workflows/${tool.workflowId}/execute`

    const executeHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (apiKey) {
      executeHeaders['X-API-Key'] = apiKey
    }

    const executeResponse = await fetch(executeUrl, {
      method: 'POST',
      headers: executeHeaders,
      body: JSON.stringify({
        input: args,
        triggerType: 'mcp',
      }),
    })

    const executeResult = await executeResponse.json()

    if (!executeResponse.ok) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: executeResult.error || 'Workflow execution failed' }),
          },
        ],
        isError: true,
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(executeResult.output || executeResult, null, 2),
        },
      ],
      isError: !executeResult.success,
    }
  } catch (error) {
    logger.error(`Error executing workflow ${tool.workflowId}:`, error)
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Tool execution failed' }) }],
      isError: true,
    }
  }
}

/**
 * Handles an MCP JSON-RPC request using the SDK
 */
export async function handleMcpRequest(
  context: ServerContext,
  request: Request
): Promise<Response> {
  try {
    // Parse the incoming JSON-RPC message
    const body = await request.json()
    const message = body as JSONRPCMessage

    // Create transport and server
    const transport = new NextJsTransport()
    const server = await createConfiguredMcpServer(context)

    // Connect server to transport
    await server.connect(transport)

    // Inject the received message
    transport.receiveMessage(message)

    // Wait for the response
    const response = await transport.waitForResponse()

    // Clean up
    await server.close()

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-MCP-Server-Name': context.serverName,
      },
    })
  } catch (error) {
    logger.error('Error handling MCP request:', error)

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: 'Internal error',
        },
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

/**
 * Creates an SSE stream for MCP notifications (used for GET requests)
 */
export function createMcpSseStream(context: ServerContext): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let isStreamClosed = false

  return new ReadableStream({
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
            name: context.serverName,
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
    },

    cancel() {
      isStreamClosed = true
      logger.info(`SSE connection closed for server ${context.serverId}`)
    },
  })
}
