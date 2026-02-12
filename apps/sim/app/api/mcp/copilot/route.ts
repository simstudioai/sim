import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  type JSONRPCError,
  ListToolsRequestSchema,
  type ListToolsResult,
  McpError,
  type RequestId,
} from '@modelcontextprotocol/sdk/types.js'
import { db } from '@sim/db'
import { userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import {
  ORCHESTRATION_TIMEOUT_MS,
  SIM_AGENT_API_URL,
  SIM_AGENT_VERSION,
} from '@/lib/copilot/constants'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import { orchestrateSubagentStream } from '@/lib/copilot/orchestrator/subagent'
import {
  executeToolServerSide,
  prepareExecutionContext,
} from '@/lib/copilot/orchestrator/tool-executor'
import { env } from '@/lib/core/config/env'
import { RateLimiter } from '@/lib/core/rate-limiter'
import {
  authorizeWorkflowByWorkspacePermission,
  resolveWorkflowIdForUser,
} from '@/lib/workflows/utils'

const logger = createLogger('CopilotMcpAPI')
const mcpRateLimiter = new RateLimiter()
const DEFAULT_COPILOT_MODEL = 'claude-opus-4-6'
const MCP_TOOL_MANIFEST_CACHE_TTL_MS = 60_000

type McpDirectToolDef = {
  name: string
  description: string
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  toolId: string
}

type McpSubagentToolDef = {
  name: string
  description: string
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  agentId: string
}

type McpToolManifest = {
  directTools: McpDirectToolDef[]
  subagentTools: McpSubagentToolDef[]
  generatedAt?: string
}

let cachedMcpToolManifest: {
  value: McpToolManifest
  expiresAt: number
} | null = null

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

interface CopilotKeyAuthResult {
  success: boolean
  userId?: string
  error?: string
}

/**
 * Validates a copilot API key by forwarding it to the Go copilot service's
 * `/api/validate-key` endpoint. Returns the associated userId on success.
 */
async function authenticateCopilotApiKey(apiKey: string): Promise<CopilotKeyAuthResult> {
  try {
    const internalSecret = env.INTERNAL_API_SECRET
    if (!internalSecret) {
      logger.error('INTERNAL_API_SECRET not configured')
      return { success: false, error: 'Server configuration error' }
    }

    const res = await fetch(`${SIM_AGENT_API_URL}/api/validate-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': internalSecret,
      },
      body: JSON.stringify({ targetApiKey: apiKey }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => null)
      const upstream = (body as Record<string, unknown>)?.message
      const status = res.status

      if (status === 401 || status === 403) {
        return {
          success: false,
          error: `Invalid Copilot API key. Generate a new key in Settings → Copilot and set it in the x-api-key header.`,
        }
      }
      if (status === 402) {
        return {
          success: false,
          error: `Usage limit exceeded for this Copilot API key. Upgrade your plan or wait for your quota to reset.`,
        }
      }

      return { success: false, error: String(upstream ?? 'Copilot API key validation failed') }
    }

    const data = (await res.json()) as { ok?: boolean; userId?: string }
    if (!data.ok || !data.userId) {
      return {
        success: false,
        error: 'Invalid Copilot API key. Generate a new key in Settings → Copilot.',
      }
    }

    return { success: true, userId: data.userId }
  } catch (error) {
    logger.error('Copilot API key validation failed', { error })
    return {
      success: false,
      error:
        'Could not validate Copilot API key — the authentication service is temporarily unreachable. This is NOT a problem with the API key itself; please retry shortly.',
    }
  }
}

export function isMcpToolManifest(value: unknown): value is McpToolManifest {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return Array.isArray(payload.directTools) && Array.isArray(payload.subagentTools)
}

export async function fetchMcpToolManifestFromCopilot(): Promise<McpToolManifest> {
  const internalSecret = env.INTERNAL_API_SECRET
  if (!internalSecret) {
    throw new Error('INTERNAL_API_SECRET not configured')
  }

  const res = await fetch(`${SIM_AGENT_API_URL}/api/mcp/tools/manifest`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': internalSecret,
    },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(`manifest fetch failed (${res.status}): ${bodyText || res.statusText}`)
  }

  const payload: unknown = await res.json()
  if (!isMcpToolManifest(payload)) {
    throw new Error('invalid manifest payload from copilot')
  }

  return payload
}

export async function getMcpToolManifest(): Promise<McpToolManifest> {
  const now = Date.now()
  if (cachedMcpToolManifest && cachedMcpToolManifest.expiresAt > now) {
    return cachedMcpToolManifest.value
  }

  const manifest = await fetchMcpToolManifestFromCopilot()
  cachedMcpToolManifest = {
    value: manifest,
    expiresAt: now + MCP_TOOL_MANIFEST_CACHE_TTL_MS,
  }
  return manifest
}

export function clearMcpToolManifestCacheForTests(): void {
  cachedMcpToolManifest = null
}

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
3. \`sim_build(request, workflowId)\` → plan and build in one pass
4. \`sim_test(request, workflowId)\` → verify it works
5. \`sim_deploy("deploy as api", workflowId)\` → make it accessible externally (optional)

For fine-grained control, use \`sim_plan\` → \`sim_edit\` instead of \`sim_build\`. Pass the plan object from sim_plan EXACTLY as-is to sim_edit's context.plan field.

### Working with Existing Workflows

When the user refers to a workflow by name or description ("the email one", "my Slack bot"):
1. Use \`sim_discovery\` to find it by functionality
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
- If the user reports errors → use \`sim_debug\` first, don't guess.
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
  private _controller: ReadableStreamDefaultController<Uint8Array> | null = null
  private _pendingChunks: Uint8Array[] = []
  private _closeHandlers: Array<() => void> = []
  private _errorHandlers: Array<(error: Error) => void> = []
  private _headersWritten = false
  private _ended = false
  private _headersPromise: Promise<void>
  private _resolveHeaders: (() => void) | null = null
  private _endedPromise: Promise<void>
  private _resolveEnded: (() => void) | null = null
  readonly readable: ReadableStream<Uint8Array>

  constructor() {
    this._headersPromise = new Promise<void>((resolve) => {
      this._resolveHeaders = resolve
    })

    this._endedPromise = new Promise<void>((resolve) => {
      this._resolveEnded = resolve
    })

    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this._controller = controller
        if (this._pendingChunks.length > 0) {
          for (const chunk of this._pendingChunks) {
            controller.enqueue(chunk)
          }
          this._pendingChunks = []
        }
      },
      cancel: () => {
        this._ended = true
        this._resolveEnded?.()
        this.triggerCloseHandlers()
      },
    })
  }

  private markHeadersWritten(): void {
    if (this._headersWritten) return
    this._headersWritten = true
    this._resolveHeaders?.()
  }

  private triggerCloseHandlers(): void {
    for (const handler of this._closeHandlers) {
      try {
        handler()
      } catch (error) {
        this.triggerErrorHandlers(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  private triggerErrorHandlers(error: Error): void {
    for (const errorHandler of this._errorHandlers) {
      errorHandler(error)
    }
  }

  private normalizeChunk(chunk: unknown): Uint8Array | null {
    if (typeof chunk === 'string') {
      return new TextEncoder().encode(chunk)
    }

    if (chunk instanceof Uint8Array) {
      return chunk
    }

    if (chunk === undefined || chunk === null) {
      return null
    }

    return new TextEncoder().encode(String(chunk))
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

    this.markHeadersWritten()
    return this
  }

  flushHeaders(): this {
    this.markHeadersWritten()
    return this
  }

  write(chunk: unknown): boolean {
    const normalized = this.normalizeChunk(chunk)
    if (!normalized) return true

    this.markHeadersWritten()

    if (this._controller) {
      try {
        this._controller.enqueue(normalized)
      } catch (error) {
        this.triggerErrorHandlers(error instanceof Error ? error : new Error(String(error)))
      }
    } else {
      this._pendingChunks.push(normalized)
    }

    return true
  }

  end(chunk?: unknown): this {
    if (chunk !== undefined) this.write(chunk)
    this.markHeadersWritten()
    if (this._ended) return this

    this._ended = true
    this._resolveEnded?.()

    if (this._controller) {
      try {
        this._controller.close()
      } catch (error) {
        this.triggerErrorHandlers(error instanceof Error ? error : new Error(String(error)))
      }
    }

    this.triggerCloseHandlers()

    return this
  }

  async waitForHeaders(timeoutMs = 30000): Promise<void> {
    if (this._headersWritten) return

    await Promise.race([
      this._headersPromise,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs)
      }),
    ])
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
    return new NextResponse(this.readable, {
      status: this._status,
      headers: this._headers,
    })
  }
}

function buildMcpServer(abortSignal?: AbortSignal): Server {
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
    const manifest = await getMcpToolManifest()

    const directTools = manifest.directTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))

    const subagentTools = manifest.subagentTools.map((tool) => ({
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
      return {
        content: [
          {
            type: 'text' as const,
            text: 'AUTHENTICATION ERROR: No Copilot API key provided. The user must set their Copilot API key in the x-api-key header. They can generate one in the Sim app under Settings → Copilot. Do NOT retry — this will fail until the key is configured.',
          },
        ],
        isError: true,
      }
    }

    const authResult = await authenticateCopilotApiKey(apiKeyHeader)
    if (!authResult.success || !authResult.userId) {
      logger.warn('MCP copilot key auth failed', { method: request.method })
      return {
        content: [
          {
            type: 'text' as const,
            text: `AUTHENTICATION ERROR: ${authResult.error} Do NOT retry — this will fail until the user fixes their Copilot API key.`,
          },
        ],
        isError: true,
      }
    }

    const rateLimitResult = await mcpRateLimiter.checkRateLimitWithSubscription(
      authResult.userId,
      await getHighestPrioritySubscription(authResult.userId),
      'api-endpoint',
      false
    )

    if (!rateLimitResult.allowed) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `RATE LIMIT: Too many requests. Please wait and retry after ${rateLimitResult.resetAt.toISOString()}.`,
          },
        ],
        isError: true,
      }
    }

    const params = request.params as
      | { name?: string; arguments?: Record<string, unknown> }
      | undefined
    if (!params?.name) {
      throw new McpError(ErrorCode.InvalidParams, 'Tool name required')
    }

    const manifest = await getMcpToolManifest()

    const result = await handleToolsCall(
      {
        name: params.name,
        arguments: params.arguments,
      },
      authResult.userId,
      manifest,
      abortSignal
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
  const server = buildMcpServer(request.signal)
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
    await responseCapture.waitForHeaders()
    // Must exceed the longest possible tool execution (build = 5 min).
    // Using ORCHESTRATION_TIMEOUT_MS + 60 s buffer so the orchestrator can
    // finish or time-out on its own before the transport is torn down.
    await responseCapture.waitForEnd(ORCHESTRATION_TIMEOUT_MS + 60_000)
    return responseCapture.toNextResponse()
  } finally {
    await server.close().catch(() => {})
    await transport.close().catch(() => {})
  }
}

export async function GET() {
  // Return 405 to signal that server-initiated SSE notifications are not
  // supported.  Without this, clients like mcp-remote will repeatedly
  // reconnect trying to open an SSE stream, flooding the logs with GETs.
  return new NextResponse(null, { status: 405 })
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

export async function DELETE(request: NextRequest) {
  void request
  return NextResponse.json(createError(0, -32000, 'Method not allowed.'), { status: 405 })
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
  userId: string,
  manifest: McpToolManifest,
  abortSignal?: AbortSignal
): Promise<CallToolResult> {
  const args = params.arguments || {}

  const directTool = manifest.directTools.find((tool) => tool.name === params.name)
  if (directTool) {
    return handleDirectToolCall(directTool, args, userId)
  }

  const subagentTool = manifest.subagentTools.find((tool) => tool.name === params.name)
  if (subagentTool) {
    return handleSubagentToolCall(subagentTool, args, userId, abortSignal)
  }

  throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${params.name}`)
}

async function handleDirectToolCall(
  toolDef: McpDirectToolDef,
  args: Record<string, unknown>,
  userId: string
): Promise<CallToolResult> {
  try {
    const execContext = await prepareExecutionContext(userId, (args.workflowId as string) || '')

    const toolCall = {
      id: randomUUID(),
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
  userId: string,
  abortSignal?: AbortSignal
): Promise<CallToolResult> {
  try {
    const requestText = (args.request as string) || JSON.stringify(args)
    const workflowId = args.workflowId as string | undefined

    const resolved = workflowId
      ? await (async () => {
          const authorization = await authorizeWorkflowByWorkspacePermission({
            workflowId,
            userId,
            action: 'read',
          })
          return authorization.allowed ? { workflowId } : null
        })()
      : await resolveWorkflowIdForUser(userId)

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

    const chatId = randomUUID()

    const requestPayload = {
      message: requestText,
      workflowId: resolved.workflowId,
      userId,
      model: DEFAULT_COPILOT_MODEL,
      mode: 'agent',
      commands: ['fast'],
      messageId: randomUUID(),
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
      abortSignal,
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
  toolDef: McpSubagentToolDef,
  args: Record<string, unknown>,
  userId: string,
  abortSignal?: AbortSignal
): Promise<CallToolResult> {
  if (toolDef.agentId === 'build') {
    return handleBuildToolCall(args, userId, abortSignal)
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

    const result = await orchestrateSubagentStream(
      toolDef.agentId,
      {
        message: requestText,
        workflowId: args.workflowId,
        workspaceId: args.workspaceId,
        context,
        model: DEFAULT_COPILOT_MODEL,
        headless: true,
        source: 'mcp',
      },
      {
        userId,
        workflowId: args.workflowId as string | undefined,
        workspaceId: args.workspaceId as string | undefined,
        abortSignal,
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
