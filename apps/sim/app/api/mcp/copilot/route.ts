import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  isJSONRPCNotification,
  isJSONRPCRequest,
  type JSONRPCError,
  type JSONRPCMessage,
  type ListToolsResult,
  ListToolsRequestSchema,
  McpError,
  type MessageExtraInfo,
  type RequestId,
} from '@modelcontextprotocol/sdk/types.js'
import { db } from '@sim/db'
import { userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { checkServerSideUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { getCopilotModel } from '@/lib/copilot/config'
import { SIM_AGENT_VERSION } from '@/lib/copilot/constants'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import { orchestrateSubagentStream } from '@/lib/copilot/orchestrator/subagent'
import {
  executeToolServerSide,
  prepareExecutionContext,
} from '@/lib/copilot/orchestrator/tool-executor'
import { DIRECT_TOOL_DEFS, SUBAGENT_TOOL_DEFS } from '@/lib/copilot/tools/mcp/definitions'
import { resolveWorkflowIdForUser } from '@/lib/workflows/utils'

const logger = createLogger('CopilotMcpAPI')

export const dynamic = 'force-dynamic'

/**
 * MCP Server instructions that guide LLMs on how to use the Sim copilot tools.
 * This is included in the initialize response to help external LLMs understand
 * the workflow lifecycle and best practices.
 */
const MCP_SERVER_INSTRUCTIONS = `
## Sim Workflow Copilot

Sim is a workflow automation platform. Workflows are visual pipelines of connected blocks (Agent, Function, Condition, API, integrations, etc.). The Agent block is the core — an LLM with tools, memory, structured output, and knowledge bases.

### Workflow Lifecycle (Happy Path)

1. \`list_workspaces\` → know where to work
2. \`create_workflow(name, workspaceId)\` → get a workflowId
3. \`copilot_build(request, workflowId)\` → plan and build in one pass
4. \`copilot_test(request, workflowId)\` → verify it works
5. \`copilot_deploy("deploy as api", workflowId)\` → make it accessible externally (optional)

For fine-grained control, use \`copilot_plan\` → \`copilot_edit\` instead of \`copilot_build\`. Pass the plan object from copilot_plan EXACTLY as-is to copilot_edit's context.plan field.

### Working with Existing Workflows

When the user refers to a workflow by name or description ("the email one", "my Slack bot"):
1. Use \`copilot_discovery\` to find it by functionality
2. Or use \`list_workflows\` and match by name
3. Then pass the workflowId to other tools

### Organization

- \`rename_workflow\` — rename a workflow
- \`move_workflow\` — move a workflow into a folder (or root with null)
- \`move_folder\` — nest a folder inside another (or root with null)
- \`create_folder(name, parentId)\` — create nested folder hierarchies

### Key Rules

- You can test workflows immediately after building — deployment is only needed for external access (API, chat, MCP).
- All copilot tools (build, plan, edit, deploy, test, debug) require workflowId.
- If the user reports errors → use \`copilot_debug\` first, don't guess.
- Variable syntax: \`<blockname.field>\` for block outputs, \`{{ENV_VAR}}\` for env vars.
`

class SingleRequestTransport implements Transport {
  private started = false
  private outgoing: JSONRPCMessage[] = []
  private waitingResolvers: Array<(message: JSONRPCMessage) => void> = []

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void
  sessionId?: string

  async start(): Promise<void> {
    if (this.started) {
      throw new Error('Transport already started')
    }
    this.started = true
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.outgoing.push(message)
    const resolver = this.waitingResolvers.shift()
    if (resolver) {
      resolver(message)
    }
  }

  async close(): Promise<void> {
    this.onclose?.()
  }

  async dispatch(message: JSONRPCMessage, extra?: MessageExtraInfo): Promise<void> {
    if (!this.onmessage) {
      throw new Error('Transport is not connected to an MCP server')
    }

    await Promise.resolve(this.onmessage(message, extra))
  }

  consumeResponse(): JSONRPCMessage | null {
    if (this.outgoing.length === 0) {
      return null
    }

    const [firstResponse] = this.outgoing
    this.outgoing = []
    return firstResponse
  }

  async waitForResponse(timeoutMs = 5000): Promise<JSONRPCMessage | null> {
    const immediate = this.consumeResponse()
    if (immediate) {
      return immediate
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const index = this.waitingResolvers.indexOf(resolver)
        if (index >= 0) {
          this.waitingResolvers.splice(index, 1)
        }
        resolve(null)
      }, timeoutMs)

      const resolver = (message: JSONRPCMessage) => {
        clearTimeout(timeout)
        resolve(message)
      }

      this.waitingResolvers.push(resolver)
    })
  }
}

function createError(id: RequestId, code: ErrorCode | number, message: string): JSONRPCError {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  }
}

function buildMcpServer(userId?: string): Server {
  const server = new Server(
    {
      name: 'sim-copilot',
      version: '1.0.0',
    },
    {
      capabilities: { tools: {} },
      instructions: MCP_SERVER_INSTRUCTIONS,
    }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const directTools = DIRECT_TOOL_DEFS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))

    const subagentTools = SUBAGENT_TOOL_DEFS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))

    const result: ListToolsResult = {
      tools: [...directTools, ...subagentTools],
    }

    return result
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!userId) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'API key required. Set the x-api-key header with a valid Sim API key.'
      )
    }

    const params = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined
    if (!params?.name) {
      throw new McpError(ErrorCode.InvalidParams, 'Tool name required')
    }

    return handleToolsCall(
      {
        name: params.name,
        arguments: params.arguments,
      },
      userId
    )
  })

  return server
}

async function handleMcpRequestWithSdk(
  message: JSONRPCMessage,
  userId?: string
): Promise<JSONRPCMessage | null> {
  const server = buildMcpServer(userId)
  const transport = new SingleRequestTransport()

  await server.connect(transport)

  try {
    await transport.dispatch(message)
    return transport.waitForResponse()
  } finally {
    await server.close().catch(() => {})
    await transport.close().catch(() => {})
  }
}

export async function GET() {
  return NextResponse.json({
    name: 'copilot-subagents',
    version: '1.0.0',
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
  })
}

export async function POST(request: NextRequest) {
  let requestId: RequestId = 0

  try {
    let body: JSONRPCMessage

    try {
      body = (await request.json()) as JSONRPCMessage
    } catch {
      return NextResponse.json(createError(0, ErrorCode.ParseError, 'Invalid JSON body'), {
        status: 400,
      })
    }

    if (isJSONRPCNotification(body)) {
      return new NextResponse(null, { status: 202 })
    }

    if (!isJSONRPCRequest(body)) {
      return NextResponse.json(
        createError(0, ErrorCode.InvalidRequest, 'Invalid JSON-RPC message'),
        { status: 400 }
      )
    }

    requestId = body.id

    let userId: string | undefined

    if (body.method === 'tools/call') {
      const apiKeyHeader = request.headers.get('x-api-key')
      if (!apiKeyHeader) {
        return NextResponse.json(
          createError(
            requestId,
            -32000,
            'API key required. Set the x-api-key header with a valid Sim API key.'
          ),
          { status: 401 }
        )
      }

      const authResult = await authenticateApiKeyFromHeader(apiKeyHeader)
      if (!authResult.success || !authResult.userId) {
        logger.warn('MCP auth failed', {
          error: authResult.error,
          method: body.method,
        })

        return NextResponse.json(
          createError(requestId, -32000, authResult.error || 'Invalid API key'),
          { status: 401 }
        )
      }

      userId = authResult.userId

      if (authResult.keyId) {
        updateApiKeyLastUsed(authResult.keyId).catch((error) => {
          logger.warn('Failed to update API key last-used timestamp', {
            keyId: authResult.keyId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }

      const usageCheck = await checkServerSideUsageLimits(userId)
      if (usageCheck.isExceeded) {
        return NextResponse.json(
          createError(
            requestId,
            -32000,
            `Usage limit exceeded: ${usageCheck.message || 'Upgrade your plan.'}`
          ),
          { status: 402 }
        )
      }
    }

    const responseMessage = await handleMcpRequestWithSdk(body, userId)

    if (body.method === 'tools/call' && userId) {
      trackMcpCopilotCall(userId)
    }

    if (!responseMessage) {
      return new NextResponse(null, { status: 202 })
    }

    return NextResponse.json(responseMessage)
  } catch (error) {
    logger.error('Error handling MCP request', { error })
    return NextResponse.json(createError(requestId, ErrorCode.InternalError, 'Internal error'), {
      status: 500,
    })
  }
}

/**
 * Increment MCP copilot call counter in userStats (fire-and-forget).
 */
function trackMcpCopilotCall(userId: string): void {
  db.update(userStats)
    .set({
      totalMcpCopilotCalls: sql`total_mcp_copilot_calls + 1`,
      lastActive: new Date(),
    })
    .where(eq(userStats.userId, userId))
    .then(() => {})
    .catch((error) => {
      logger.error('Failed to track MCP copilot call', { error, userId })
    })
}

async function handleToolsCall(
  params: { name: string; arguments?: Record<string, unknown> },
  userId: string
): Promise<CallToolResult> {
  const args = params.arguments || {}

  const directTool = DIRECT_TOOL_DEFS.find((tool) => tool.name === params.name)
  if (directTool) {
    return handleDirectToolCall(directTool, args, userId)
  }

  const subagentTool = SUBAGENT_TOOL_DEFS.find((tool) => tool.name === params.name)
  if (subagentTool) {
    return handleSubagentToolCall(subagentTool, args, userId)
  }

  throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${params.name}`)
}

async function handleDirectToolCall(
  toolDef: (typeof DIRECT_TOOL_DEFS)[number],
  args: Record<string, unknown>,
  userId: string
): Promise<CallToolResult> {
  try {
    const execContext = await prepareExecutionContext(userId, (args.workflowId as string) || '')

    const toolCall = {
      id: crypto.randomUUID(),
      name: toolDef.toolId,
      status: 'pending' as const,
      params: args as Record<string, any>,
      startTime: Date.now(),
    }

    const result = await executeToolServerSide(toolCall, execContext)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result.output ?? result, null, 2),
        },
      ],
      isError: !result.success,
    }
  } catch (error) {
    logger.error('Direct tool execution failed', { tool: toolDef.name, error })
    return {
      content: [
        {
          type: 'text',
          text: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}

/**
 * Build mode uses the main chat orchestrator with the 'fast' command instead of
 * the subagent endpoint. In Go, 'build' is not a registered subagent — it's a mode
 * (ModeFast) on the main chat processor that bypasses subagent orchestration and
 * executes all tools directly.
 */
async function handleBuildToolCall(
  args: Record<string, unknown>,
  userId: string
): Promise<CallToolResult> {
  try {
    const requestText = (args.request as string) || JSON.stringify(args)
    const { model } = getCopilotModel('chat')
    const workflowId = args.workflowId as string | undefined

    const resolved = workflowId ? { workflowId } : await resolveWorkflowIdForUser(userId)

    if (!resolved?.workflowId) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'workflowId is required for build. Call create_workflow first.',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      }
    }

    const chatId = crypto.randomUUID()

    const requestPayload = {
      message: requestText,
      workflowId: resolved.workflowId,
      userId,
      model,
      mode: 'agent',
      commands: ['fast'],
      messageId: crypto.randomUUID(),
      version: SIM_AGENT_VERSION,
      headless: true,
      chatId,
      source: 'mcp',
    }

    const result = await orchestrateCopilotStream(requestPayload, {
      userId,
      workflowId: resolved.workflowId,
      chatId,
      autoExecuteTools: true,
      timeout: 300000,
      interactive: false,
    })

    const responseData = {
      success: result.success,
      content: result.content,
      toolCalls: result.toolCalls,
      error: result.error,
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(responseData, null, 2) }],
      isError: !result.success,
    }
  } catch (error) {
    logger.error('Build tool call failed', { error })
    return {
      content: [
        {
          type: 'text',
          text: `Build failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}

async function handleSubagentToolCall(
  toolDef: (typeof SUBAGENT_TOOL_DEFS)[number],
  args: Record<string, unknown>,
  userId: string
): Promise<CallToolResult> {
  if (toolDef.agentId === 'build') {
    return handleBuildToolCall(args, userId)
  }

  try {
    const requestText =
      (args.request as string) ||
      (args.message as string) ||
      (args.error as string) ||
      JSON.stringify(args)

    const context = (args.context as Record<string, unknown>) || {}
    if (args.plan && !context.plan) {
      context.plan = args.plan
    }

    const { model } = getCopilotModel('chat')

    const result = await orchestrateSubagentStream(
      toolDef.agentId,
      {
        message: requestText,
        workflowId: args.workflowId,
        workspaceId: args.workspaceId,
        context,
        model,
        headless: true,
        source: 'mcp',
      },
      {
        userId,
        workflowId: args.workflowId as string | undefined,
        workspaceId: args.workspaceId as string | undefined,
      }
    )

    let responseData: unknown

    if (result.structuredResult) {
      responseData = {
        success: result.structuredResult.success ?? result.success,
        type: result.structuredResult.type,
        summary: result.structuredResult.summary,
        data: result.structuredResult.data,
      }
    } else if (result.error) {
      responseData = {
        success: false,
        error: result.error,
        errors: result.errors,
      }
    } else {
      responseData = {
        success: result.success,
        content: result.content,
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(responseData, null, 2),
        },
      ],
      isError: !result.success,
    }
  } catch (error) {
    logger.error('Subagent tool call failed', {
      tool: toolDef.name,
      agentId: toolDef.agentId,
      error,
    })

    return {
      content: [
        {
          type: 'text',
          text: `Subagent call failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}
