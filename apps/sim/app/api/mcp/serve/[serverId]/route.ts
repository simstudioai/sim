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
  type JSONRPCResultResponse,
  LATEST_PROTOCOL_VERSION,
  type ListToolsResult,
  type RequestId,
  SUPPORTED_PROTOCOL_VERSIONS,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { db } from '@sim/db'
import { workflow, workflowMcpServer, workflowMcpTool, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  mcpJsonRpcNotificationSchema,
  mcpJsonRpcRequestSchema,
  mcpServeRouteParamsSchema,
  mcpToolCallParamsSchema,
} from '@/lib/api/contracts/mcp'
import { AuthType, checkHybridAuth } from '@/lib/auth/hybrid'
import { generateInternalToken } from '@/lib/auth/internal'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import {
  assertContentLengthWithinLimit,
  assertKnownSizeWithinLimit,
  isPayloadSizeLimitError,
  readResponseTextWithLimit,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { SIM_VIA_HEADER } from '@/lib/execution/call-chain'
import {
  MAX_MCP_PARAMETER_SCHEMA_BYTES,
  MAX_MCP_TOOLS_LIST_RESPONSE_BYTES,
  MAX_MCP_TOOLS_PER_SERVER,
  MAX_MCP_WORKFLOW_RESPONSE_BYTES,
  MCP_TOOL_BRIDGE_ACTOR_HEADER,
  MCP_TOOL_BRIDGE_HEADER,
} from '@/lib/mcp/constants'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkflowMcpServeAPI')
const MAX_MCP_SERVE_BODY_BYTES = 10 * 1024 * 1024
const MAX_MCP_WORKFLOW_REQUEST_BYTES = 10 * 1024 * 1024
const MAX_MCP_TOOL_RESULT_TEXT_BYTES = 10 * 1024 * 1024
const MAX_MCP_TOOLS_LIST_COUNT = MAX_MCP_TOOLS_PER_SERVER
const MAX_MCP_TOOLS_LIST_SCHEMA_BYTES = MAX_MCP_PARAMETER_SCHEMA_BYTES
const MB = 1024 * 1024

function negotiateProtocolVersion(rpcParams: unknown): string {
  const requested =
    rpcParams && typeof rpcParams === 'object' && 'protocolVersion' in rpcParams
      ? (rpcParams as { protocolVersion?: unknown }).protocolVersion
      : undefined
  if (typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested
  }
  return LATEST_PROTOCOL_VERSION
}

export const dynamic = 'force-dynamic'

interface RouteParams {
  serverId: string
}

interface ExecuteAuthContext {
  userId: string
  useAuthenticatedUserAsActor: boolean
}

function createResponse(id: RequestId, result: unknown): JSONRPCResultResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: result as JSONRPCResultResponse['result'],
  }
}

function createError(
  id: RequestId,
  code: ErrorCode | number,
  message: string,
  data?: unknown
): JSONRPCError {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined && { data }) },
  }
}

function clientCancelledJsonRpcResponse(id: RequestId): NextResponse {
  return NextResponse.json(
    createError(id, ErrorCode.ConnectionClosed, 'Client cancelled request'),
    {
      status: 499,
    }
  )
}

function callerAbortedJsonRpcResponse(
  id: RequestId,
  abortSignal?: ManagedAbortSignal | null
): NextResponse | null {
  return abortSignal?.isCallerAborted() ? clientCancelledJsonRpcResponse(id) : null
}

function limitMessage(label: string, maxBytes: number): string {
  return `${label} exceeds maximum size of ${Math.round(maxBytes / MB)}MB`
}

async function readJsonRpcBody(request: NextRequest): Promise<unknown> {
  assertContentLengthWithinLimit(request.headers, MAX_MCP_SERVE_BODY_BYTES, 'MCP request body')
  const buffer = await readStreamToBufferWithLimit(request.body, {
    maxBytes: MAX_MCP_SERVE_BODY_BYTES,
    label: 'MCP request body',
    signal: request.signal,
  })
  return JSON.parse(buffer.toString('utf-8'))
}

interface ManagedAbortSignal {
  signal: AbortSignal
  cleanup: () => void
  isCallerAborted: () => boolean
  isTimedOut: () => boolean
}

function createManagedAbortSignal(
  parentSignal: AbortSignal,
  timeoutMs: number
): ManagedAbortSignal {
  const controller = new AbortController()
  let callerAborted = false
  let timedOut = false

  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort(new Error(`MCP workflow execution timed out after ${timeoutMs}ms`))
  }, timeoutMs)

  const abortFromParent = () => {
    callerAborted = true
    controller.abort(parentSignal.reason ?? new Error('MCP client disconnected'))
  }

  if (parentSignal.aborted) {
    abortFromParent()
  } else {
    parentSignal.addEventListener('abort', abortFromParent, { once: true })
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId)
      parentSignal.removeEventListener('abort', abortFromParent)
    },
    isCallerAborted: () => callerAborted || parentSignal.aborted,
    isTimedOut: () => timedOut,
  }
}

function serializeToolText(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? 'null'
  assertKnownSizeWithinLimit(
    Buffer.byteLength(text, 'utf-8'),
    MAX_MCP_TOOL_RESULT_TEXT_BYTES,
    'MCP tool result text'
  )
  return text
}

function createJsonRpcResponseWithLimit(
  id: RequestId,
  result: unknown,
  maxBytes: number,
  label: string
): NextResponse {
  const responseBody = createResponse(id, result)
  const responseText = JSON.stringify(responseBody)
  assertKnownSizeWithinLimit(Buffer.byteLength(responseText, 'utf-8'), maxBytes, label)
  return new NextResponse(responseText, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function toToolInputSchema(schema: unknown): Partial<Tool['inputSchema']> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {}

  const candidate = schema as Record<string, unknown>
  const properties =
    candidate.properties &&
    typeof candidate.properties === 'object' &&
    !Array.isArray(candidate.properties)
      ? (candidate.properties as Tool['inputSchema']['properties'])
      : {}
  const required = Array.isArray(candidate.required)
    ? candidate.required.filter((entry): entry is string => typeof entry === 'string')
    : undefined

  return {
    properties,
    ...(required && required.length > 0 && { required }),
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonValue(text: string): { success: true; value: unknown } | { success: false } {
  if (!text) return { success: true, value: {} }
  try {
    return { success: true, value: JSON.parse(text) }
  } catch {
    return { success: false }
  }
}

function hasResponseField(value: Record<string, unknown>, property: string): boolean {
  return Object.hasOwn(value, property)
}

function getWorkflowErrorStatus(status: number): number {
  return [400, 401, 403, 404, 408, 409, 413, 429, 499, 503].includes(status) ? status : 500
}

function getWorkflowErrorCode(status: number, executeResult: Record<string, unknown>): ErrorCode {
  if (status === 499) return ErrorCode.ConnectionClosed
  if (status === 400) return ErrorCode.InvalidParams
  if (status === 413 && executeResult.code !== 'workflow_response_too_large') {
    return ErrorCode.InvalidRequest
  }
  return ErrorCode.InternalError
}

function getToolsListCursor(rpcParams: unknown): string | undefined {
  if (!rpcParams || typeof rpcParams !== 'object' || !('cursor' in rpcParams)) return undefined
  const cursor = (rpcParams as { cursor?: unknown }).cursor
  return typeof cursor === 'string' && cursor.length > 0 ? cursor : undefined
}

async function getDuplicateToolName(serverId: string): Promise<string | null> {
  const [duplicate] = await db
    .select({ toolName: workflowMcpTool.toolName })
    .from(workflowMcpTool)
    .where(and(eq(workflowMcpTool.serverId, serverId), isNull(workflowMcpTool.archivedAt)))
    .groupBy(workflowMcpTool.toolName)
    .having(sql`count(*) > 1`)
    .limit(1)

  return duplicate?.toolName ?? null
}

async function readWorkflowExecutionResult(
  response: Response,
  signal: AbortSignal
): Promise<unknown> {
  const text = await readResponseTextWithLimit(response, {
    maxBytes: MAX_MCP_WORKFLOW_RESPONSE_BYTES,
    label: 'MCP workflow execution response',
    signal,
  })
  const parsed = parseJsonValue(text)
  if (parsed.success) return parsed.value
  if (!response.ok) return { error: response.statusText || 'Workflow execution failed' }
  throw new Error('Invalid workflow execution response')
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
    .innerJoin(workspace, eq(workflowMcpServer.workspaceId, workspace.id))
    .where(
      and(
        eq(workflowMcpServer.id, serverId),
        isNull(workflowMcpServer.deletedAt),
        isNull(workspace.archivedAt)
      )
    )
    .limit(1)

  return server
}

type WorkflowMcpServeServer = NonNullable<Awaited<ReturnType<typeof getServer>>>

async function authorizeMcpServeRequest(
  request: NextRequest,
  server: WorkflowMcpServeServer,
  options: { requireAuthForPublic?: boolean } = {}
): Promise<{ response?: NextResponse; executeAuthContext?: ExecuteAuthContext }> {
  if (server.isPublic && !options.requireAuthForPublic) return {}

  const auth = await checkHybridAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  if (server.isPublic) return {}

  if (auth.apiKeyType === 'workspace' && auth.workspaceId !== server.workspaceId) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const workspacePermission = await getUserEntityPermissions(
    auth.userId,
    'workspace',
    server.workspaceId
  )
  if (workspacePermission === null) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return {
    executeAuthContext: {
      userId: auth.userId,
      useAuthenticatedUserAsActor:
        auth.authType === AuthType.API_KEY && auth.apiKeyType === 'personal',
    },
  }
}

function unsupportedSseTransportResponse(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'unsupported_transport',
        message: 'SSE transport is not supported for workflow MCP servers',
        supportedTransports: ['streamable-http'],
        allowedMethods: ['GET', 'POST', 'DELETE'],
      },
    },
    {
      status: 405,
      headers: {
        Allow: 'GET, POST, DELETE',
        'X-MCP-Supported-Transport': 'streamable-http',
      },
    }
  )
}

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<RouteParams> }) => {
    try {
      const { serverId } = mcpServeRouteParamsSchema.parse(await params)
      const server = await getServer(serverId)
      if (!server) {
        return NextResponse.json({ error: 'Server not found' }, { status: 404 })
      }

      const authResult = await authorizeMcpServeRequest(request, server)
      if (authResult.response) return authResult.response

      if (request.headers.get('accept')?.includes('text/event-stream')) {
        return unsupportedSseTransportResponse()
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
)

export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<RouteParams> }) => {
    try {
      const { serverId } = mcpServeRouteParamsSchema.parse(await params)
      const server = await getServer(serverId)
      if (!server) {
        return NextResponse.json({ error: 'Server not found' }, { status: 404 })
      }

      let executeAuthContext: ExecuteAuthContext | null = null
      const authResult = await authorizeMcpServeRequest(request, server)
      if (authResult.response) return authResult.response
      executeAuthContext = authResult.executeAuthContext ?? null

      let body: unknown
      try {
        body = await readJsonRpcBody(request)
      } catch (error) {
        if (isPayloadSizeLimitError(error)) {
          logger.warn('MCP request body exceeded size limit', {
            maxBytes: error.maxBytes,
            observedBytes: error.observedBytes,
          })
          return NextResponse.json(
            createError(
              0,
              ErrorCode.InvalidRequest,
              limitMessage('MCP request body', MAX_MCP_SERVE_BODY_BYTES)
            ),
            { status: 413 }
          )
        }
        if (request.signal.aborted) return clientCancelledJsonRpcResponse(0)
        return NextResponse.json(createError(0, ErrorCode.ParseError, 'Invalid JSON body'), {
          status: 400,
        })
      }
      const message = body as JSONRPCMessage

      if (isJSONRPCNotification(message)) {
        const notificationValidation = mcpJsonRpcNotificationSchema.safeParse(message)
        if (!notificationValidation.success) {
          return NextResponse.json(
            createError(0, ErrorCode.InvalidRequest, 'Invalid JSON-RPC message'),
            {
              status: 400,
            }
          )
        }

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

      const requestValidation = mcpJsonRpcRequestSchema.safeParse(message)
      if (!requestValidation.success) {
        return NextResponse.json(
          createError(0, ErrorCode.InvalidRequest, 'Invalid JSON-RPC message'),
          {
            status: 400,
          }
        )
      }

      const { id, method, params: rpcParams } = requestValidation.data

      switch (method) {
        case 'initialize': {
          const result: InitializeResult = {
            protocolVersion: negotiateProtocolVersion(rpcParams),
            capabilities: { tools: {} },
            serverInfo: { name: server.name, version: '1.0.0' },
          }
          return NextResponse.json(createResponse(id, result))
        }

        case 'ping':
          return NextResponse.json(createResponse(id, {}))

        case 'tools/list':
          return handleToolsList(id, serverId, rpcParams)

        case 'tools/call': {
          const paramsValidation = mcpToolCallParamsSchema.safeParse(rpcParams)
          if (!paramsValidation.success) {
            return NextResponse.json(
              createError(id, ErrorCode.InvalidParams, 'Invalid tool call parameters'),
              {
                status: 400,
              }
            )
          }

          return handleToolsCall(
            id,
            serverId,
            paramsValidation.data,
            executeAuthContext,
            server.isPublic ? server.createdBy : undefined,
            request.headers.get(SIM_VIA_HEADER),
            request.signal
          )
        }

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
)

async function handleToolsList(
  id: RequestId,
  serverId: string,
  rpcParams: unknown
): Promise<NextResponse> {
  try {
    const duplicateToolName = await getDuplicateToolName(serverId)
    if (duplicateToolName) {
      return NextResponse.json(
        createError(id, ErrorCode.InvalidRequest, 'MCP server has duplicate tool names', {
          code: 'duplicate_tool_name',
          toolName: duplicateToolName,
          recovery: 'Rename or remove duplicate workflow MCP tools before listing this server',
        }),
        { status: 409 }
      )
    }

    const cursor = getToolsListCursor(rpcParams)
    const pageCondition = cursor ? gt(workflowMcpTool.id, cursor) : undefined
    const toolSizes = await db
      .select({
        id: workflowMcpTool.id,
        toolNameBytes: sql<number>`octet_length(${workflowMcpTool.toolName})`,
        toolDescriptionBytes: sql<number>`coalesce(octet_length(${workflowMcpTool.toolDescription}), 0)`,
        parameterSchemaBytes: sql<number>`octet_length(${workflowMcpTool.parameterSchema}::text)`,
      })
      .from(workflowMcpTool)
      .where(
        and(
          eq(workflowMcpTool.serverId, serverId),
          isNull(workflowMcpTool.archivedAt),
          pageCondition
        )
      )
      .orderBy(asc(workflowMcpTool.id))
      .limit(MAX_MCP_TOOLS_LIST_COUNT + 1)

    const pageSizes = toolSizes.slice(0, MAX_MCP_TOOLS_LIST_COUNT)

    let estimatedSchemaBytes = 0
    let estimatedMetadataBytes = 0
    for (const toolSize of pageSizes) {
      estimatedSchemaBytes += Number(toolSize.parameterSchemaBytes) || 0
      estimatedMetadataBytes +=
        (Number(toolSize.toolNameBytes) || 0) +
        (Number(toolSize.toolDescriptionBytes) || 0) +
        (Number(toolSize.parameterSchemaBytes) || 0)
      assertKnownSizeWithinLimit(
        estimatedSchemaBytes,
        MAX_MCP_TOOLS_LIST_SCHEMA_BYTES,
        'MCP tools/list schemas'
      )
      assertKnownSizeWithinLimit(
        estimatedMetadataBytes,
        MAX_MCP_TOOLS_LIST_RESPONSE_BYTES,
        'MCP tools/list stored metadata'
      )
    }

    const tools = await db
      .select({
        id: workflowMcpTool.id,
        toolName: workflowMcpTool.toolName,
        toolDescription: workflowMcpTool.toolDescription,
        parameterSchema: workflowMcpTool.parameterSchema,
      })
      .from(workflowMcpTool)
      .where(
        and(
          eq(workflowMcpTool.serverId, serverId),
          isNull(workflowMcpTool.archivedAt),
          pageCondition
        )
      )
      .orderBy(asc(workflowMcpTool.id))
      .limit(MAX_MCP_TOOLS_LIST_COUNT + 1)

    const hasNextPage = tools.length > MAX_MCP_TOOLS_LIST_COUNT
    const pageTools = tools.slice(0, MAX_MCP_TOOLS_LIST_COUNT)
    const nextCursor = hasNextPage ? pageTools.at(-1)?.id : undefined
    let schemaBytes = 0
    const result: ListToolsResult = {
      tools: pageTools.map((tool) => {
        const schema = toToolInputSchema(tool.parameterSchema)
        const schemaByteLength = Buffer.byteLength(JSON.stringify(schema ?? {}), 'utf-8')
        schemaBytes += schemaByteLength
        assertKnownSizeWithinLimit(
          schemaBytes,
          MAX_MCP_TOOLS_LIST_SCHEMA_BYTES,
          'MCP tools/list schemas'
        )
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
      ...(nextCursor && { nextCursor }),
    }

    return createJsonRpcResponseWithLimit(
      id,
      result,
      MAX_MCP_TOOLS_LIST_RESPONSE_BYTES,
      'MCP tools/list response'
    )
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      logger.warn('MCP tools/list exceeded size limit', {
        serverId,
        maxBytes: error.maxBytes,
        observedBytes: error.observedBytes,
      })
      return NextResponse.json(
        createError(id, ErrorCode.InternalError, 'MCP tools/list response is too large', {
          code: 'payload_too_large',
          maxBytes: error.maxBytes,
          observedBytes: error.observedBytes,
          recovery: 'Reduce tool names, descriptions, schemas, or tool count before retrying',
        }),
        { status: 413 }
      )
    }
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
  executeAuthContext?: ExecuteAuthContext | null,
  publicServerOwnerId?: string,
  simViaHeader?: string | null,
  requestSignal?: AbortSignal
): Promise<NextResponse> {
  let abortSignal: ManagedAbortSignal | null = null
  try {
    if (!params?.name) {
      return NextResponse.json(createError(id, ErrorCode.InvalidParams, 'Tool name required'), {
        status: 400,
      })
    }
    abortSignal = createManagedAbortSignal(
      requestSignal ?? new AbortController().signal,
      getMaxExecutionTimeout()
    )
    const abortedBeforeToolLookup = callerAbortedJsonRpcResponse(id, abortSignal)
    if (abortedBeforeToolLookup) return abortedBeforeToolLookup

    const matchingTools = await db
      .select({
        toolName: workflowMcpTool.toolName,
        workflowId: workflowMcpTool.workflowId,
      })
      .from(workflowMcpTool)
      .where(
        and(
          eq(workflowMcpTool.serverId, serverId),
          eq(workflowMcpTool.toolName, params.name),
          isNull(workflowMcpTool.archivedAt)
        )
      )
      .orderBy(asc(workflowMcpTool.id))
      .limit(2)
    const abortedAfterToolLookup = callerAbortedJsonRpcResponse(id, abortSignal)
    if (abortedAfterToolLookup) return abortedAfterToolLookup
    if (matchingTools.length > 1) {
      return NextResponse.json(
        createError(id, ErrorCode.InvalidRequest, `Duplicate tool name: ${params.name}`, {
          code: 'duplicate_tool_name',
          toolName: params.name,
          recovery: 'Rename or remove duplicate workflow MCP tools before calling this tool',
        }),
        { status: 409 }
      )
    }
    const [tool] = matchingTools
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
      .where(and(eq(workflow.id, tool.workflowId), isNull(workflow.archivedAt)))
      .limit(1)
    const abortedAfterWorkflowLookup = callerAbortedJsonRpcResponse(id, abortSignal)
    if (abortedAfterWorkflowLookup) return abortedAfterWorkflowLookup

    if (!wf?.isDeployed) {
      return NextResponse.json(
        createError(id, ErrorCode.InternalError, 'Workflow is not deployed'),
        {
          status: 400,
        }
      )
    }

    const executeUrl = `${getInternalApiBaseUrl()}/api/workflows/${tool.workflowId}/execute`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [MCP_TOOL_BRIDGE_HEADER]: 'true',
    }

    const abortedBeforeExecute = callerAbortedJsonRpcResponse(id, abortSignal)
    if (abortedBeforeExecute) return abortedBeforeExecute

    if (publicServerOwnerId) {
      const internalToken = await generateInternalToken(publicServerOwnerId)
      headers.Authorization = `Bearer ${internalToken}`
    } else if (executeAuthContext) {
      const internalToken = await generateInternalToken(executeAuthContext.userId)
      headers.Authorization = `Bearer ${internalToken}`
      if (executeAuthContext.useAuthenticatedUserAsActor) {
        headers[MCP_TOOL_BRIDGE_ACTOR_HEADER] = 'authenticated-user'
      }
    }

    if (simViaHeader) {
      headers[SIM_VIA_HEADER] = simViaHeader
    }

    logger.info(`Executing workflow ${tool.workflowId} via MCP tool ${params.name}`)

    const workflowRequestBody = JSON.stringify({
      input: params.arguments || {},
      triggerType: 'mcp',
      includeFileBase64: false,
    })
    assertKnownSizeWithinLimit(
      Buffer.byteLength(workflowRequestBody, 'utf-8'),
      MAX_MCP_WORKFLOW_REQUEST_BYTES,
      'MCP workflow execution request body'
    )
    const response = await fetch(executeUrl, {
      method: 'POST',
      headers,
      body: workflowRequestBody,
      signal: abortSignal.signal,
    })

    const executeResult = await readWorkflowExecutionResult(response, abortSignal.signal)
    const executeResultObject = isJsonObject(executeResult) ? executeResult : null

    if (!response.ok) {
      const errorMessage =
        typeof executeResultObject?.error === 'string'
          ? executeResultObject.error
          : 'Workflow execution failed'
      const status = getWorkflowErrorStatus(response.status)
      const responseHeaders: Record<string, string> = {}
      const retryAfter = response.headers.get('retry-after')
      if (retryAfter) responseHeaders['Retry-After'] = retryAfter
      return NextResponse.json(
        createError(
          id,
          getWorkflowErrorCode(response.status, executeResultObject ?? {}),
          errorMessage,
          {
            httpStatus: response.status,
            retryable: [408, 429, 503].includes(response.status),
            code:
              typeof executeResultObject?.code === 'string' ? executeResultObject.code : undefined,
          }
        ),
        { status, headers: responseHeaders }
      )
    }

    const toolOutput =
      executeResultObject?.success === false
        ? executeResult
        : executeResultObject && hasResponseField(executeResultObject, 'output')
          ? executeResultObject.output
          : executeResult
    const result: CallToolResult = {
      content: [{ type: 'text', text: serializeToolText(toolOutput) }],
      isError: executeResultObject?.success === false,
    }

    return createJsonRpcResponseWithLimit(
      id,
      result,
      MAX_MCP_WORKFLOW_RESPONSE_BYTES,
      'MCP tool call response'
    )
  } catch (error) {
    if (abortSignal?.isTimedOut()) {
      return NextResponse.json(
        createError(id, ErrorCode.InternalError, 'Tool execution timed out', {
          code: 'timeout',
          retryable: true,
        }),
        {
          status: 408,
        }
      )
    }
    const abortedAfterExecute = callerAbortedJsonRpcResponse(id, abortSignal)
    if (abortedAfterExecute) return abortedAfterExecute
    if (isPayloadSizeLimitError(error)) {
      logger.warn('MCP tool call exceeded size limit', {
        maxBytes: error.maxBytes,
        observedBytes: error.observedBytes,
        label: error.label,
      })
      return NextResponse.json(
        createError(
          id,
          error.label === 'MCP workflow execution request body'
            ? ErrorCode.InvalidParams
            : ErrorCode.InternalError,
          limitMessage(error.label, error.maxBytes),
          {
            code: 'payload_too_large',
            maxBytes: error.maxBytes,
            observedBytes: error.observedBytes,
            retryable: false,
          }
        ),
        { status: 413 }
      )
    }
    logger.error('Error calling tool:', error)
    return NextResponse.json(createError(id, ErrorCode.InternalError, 'Tool execution failed'), {
      status: 500,
    })
  } finally {
    abortSignal?.cleanup()
  }
}

export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<RouteParams> }) => {
    try {
      const { serverId } = mcpServeRouteParamsSchema.parse(await params)
      const server = await getServer(serverId)
      if (!server) {
        return NextResponse.json({ error: 'Server not found' }, { status: 404 })
      }

      const authResult = await authorizeMcpServeRequest(request, server, {
        requireAuthForPublic: true,
      })
      if (authResult.response) return authResult.response

      logger.info(`MCP session terminated for server ${serverId}`)
      return new NextResponse(null, { status: 204 })
    } catch (error) {
      logger.error('Error handling MCP DELETE request:', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
