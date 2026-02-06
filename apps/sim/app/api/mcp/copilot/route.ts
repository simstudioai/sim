import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  type JSONRPCError,
  type ListToolsResult,
  ListToolsRequestSchema,
  McpError,
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
export const runtime = 'nodejs'

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

type HeaderMap = Record<string, string | string[] | undefined>

function createError(id: RequestId, code: ErrorCode | number, message: string): JSONRPCError {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  }
}

function normalizeRequestHeaders(request: NextRequest): HeaderMap {
  const headers: HeaderMap = {}

  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })

  return headers
}

function readHeader(headers: HeaderMap | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const value = headers[name.toLowerCase()]
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

class NextResponseCapture {
  private _status = 200
  private _headers = new Headers()
  private _chunks: Buffer[] = []
  private _closeHandlers: Array<() => void> = []
  private _errorHandlers: Array<(error: Error) => void> = []
  private _ended = false
  private _endedPromise: Promise<void>
  private _resolveEnded: (() => void) | null = null

  constructor() {
    this._endedPromise = new Promise<void>((resolve) => {
      this._resolveEnded = resolve
    })
  }

  writeHead(status: number, headers?: Record<string, string | number | string[]>): this {
    this._status = status

    if (headers) {
      Object.entries(headers).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          this._headers.set(key, value.join(', '))
        } else {
          this._headers.set(key, String(value))
        }
      })
    }

    return this
  }

  flushHeaders(): this {
    return this
  }

  write(chunk: unknown): boolean {
    if (typeof chunk === 'string') {
      this._chunks.push(Buffer.from(chunk))
      return true
    }

    if (chunk instanceof Uint8Array) {
      this._chunks.push(Buffer.from(chunk))
      return true
    }

    if (chunk !== undefined && chunk !== null) {
      this._chunks.push(Buffer.from(String(chunk)))
    }

    return true
  }

  end(chunk?: unknown): this {
    if (chunk !== undefined) {
      this.write(chunk)
    }

    this._ended = true
    this._resolveEnded?.()

    this._closeHandlers.forEach((handler) => {
      try {
        handler()
      } catch (error) {
        this._errorHandlers.forEach((errorHandler) => {
          errorHandler(error instanceof Error ? error : new Error(String(error)))
        })
      }
    })

    return this
  }

  async waitForEnd(timeoutMs = 30000): Promise<void> {
    if (this._ended) return

    await Promise.race([
      this._endedPromise,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs)
      }),
    ])
  }

  on(event: 'close' | 'error', handler: (() => void) | ((error: Error) => void)): this {
    if (event === 'close') {
      this._closeHandlers.push(handler as () => void)
    }

    if (event === 'error') {
      this._errorHandlers.push(handler as (error: Error) => void)
    }

    return this
  }

  toNextResponse(): NextResponse {
    if (this._chunks.length === 0) {
      return new NextResponse(null, {
        status: this._status,
        headers: this._headers,
      })
    }

    const body = Buffer.concat(this._chunks)
    return new NextResponse(body, {
      status: this._status,
      headers: this._headers,
    })
  }
}

function buildMcpServer(): Server {
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

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const headers = (extra.requestInfo?.headers || {}) as HeaderMap
    const apiKeyHeader = readHeader(headers, 'x-api-key')

    if (!apiKeyHeader) {
      throw new McpError(
        -32000,
        'API key required. Set the x-api-key header with a valid Sim API key.'
      )
    }

    const authResult = await authenticateApiKeyFromHeader(apiKeyHeader)
    if (!authResult.success || !authResult.userId) {
      logger.warn('MCP auth failed', {
        error: authResult.error,
        method: request.method,
      })

      throw new McpError(-32000, authResult.error || 'Invalid API key')
    }

    if (authResult.keyId) {
      updateApiKeyLastUsed(authResult.keyId).catch((error) => {
        logger.warn('Failed to update API key last-used timestamp', {
          keyId: authResult.keyId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    const usageCheck = await checkServerSideUsageLimits(authResult.userId)
    if (usageCheck.isExceeded) {
      throw new McpError(
        -32000,
        `Usage limit exceeded: ${usageCheck.message || 'Upgrade your plan.'}`
      )
    }

    const params = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined
    if (!params?.name) {
      throw new McpError(ErrorCode.InvalidParams, 'Tool name required')
    }

    const result = await handleToolsCall(
      {
        name: params.name,
        arguments: params.arguments,
      },
      authResult.userId
    )

    trackMcpCopilotCall(authResult.userId)

    return result
  })

  return server
}

async function handleMcpRequestWithSdk(
  request: NextRequest,
  parsedBody: unknown
): Promise<NextResponse> {
  const server = buildMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  const responseCapture = new NextResponseCapture()

  const requestAdapter = {
    method: request.method,
    headers: normalizeRequestHeaders(request),
  }

  await server.connect(transport)

  try {
    await transport.handleRequest(requestAdapter as any, responseCapture as any, parsedBody)
    await responseCapture.waitForEnd()
    return responseCapture.toNextResponse()
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
  try {
    let parsedBody: unknown

    try {
      parsedBody = await request.json()
    } catch {
      return NextResponse.json(createError(0, ErrorCode.ParseError, 'Invalid JSON body'), {
        status: 400,
      })
    }

    return await handleMcpRequestWithSdk(request, parsedBody)
  } catch (error) {
    logger.error('Error handling MCP request', { error })
    return NextResponse.json(createError(0, ErrorCode.InternalError, 'Internal error'), {
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
