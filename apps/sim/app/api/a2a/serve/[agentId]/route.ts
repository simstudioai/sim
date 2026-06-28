import { A2AError, JsonRpcTransportHandler } from '@a2a-js/sdk/server'
import { db } from '@sim/db'
import { a2aAgent, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { a2aServeAgentParamsSchema } from '@/lib/api/contracts/a2a-agents'
import { type AuthResult, AuthType, checkHybridAuth } from '@/lib/auth/hybrid'
import {
  API_EXECUTION_REQUIRES_PAID_PLAN_MESSAGE,
  isApiExecutionEntitled,
} from '@/lib/billing/core/api-access'
import { getClientIp } from '@/lib/core/utils/request'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'
import { SimA2ARequestHandler } from '@/app/api/a2a/serve/[agentId]/request-handler'
import { getServedAgentCard } from '@/app/api/a2a/serve/[agentId]/utils'

const logger = createLogger('A2AServeAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * JSON-RPC server-error code (-32000) for Sim-specific conditions the A2A spec
 * does not define (agent unavailable, unauthorized, billing). The real signal
 * is the HTTP status; this avoids colliding with the SDK's reserved A2A codes
 * (-32001..-32007).
 */
const A2A_SERVER_ERROR_CODE = -32000

interface RouteParams {
  agentId: string
}

function getCallerFingerprint(request: NextRequest, userId?: string | null): string {
  if (userId) {
    return `user:${userId}`
  }
  const clientIp = getClientIp(request)
  const userAgent = request.headers.get('user-agent')?.trim() || 'unknown'
  return `public:${clientIp}:${userAgent}`
}

function extractJsonRpcId(body: unknown): string | number | null {
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id: unknown }).id
    if (typeof id === 'string' || typeof id === 'number') return id
  }
  return null
}

function jsonRpcErrorResponse(
  id: string | number | null,
  error: A2AError,
  status: number
): NextResponse {
  return NextResponse.json({ jsonrpc: '2.0', id, error: error.toJSONRPCError() }, { status })
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  )
}

function streamJsonRpc(
  stream: AsyncIterable<unknown>,
  requestId: string | number | null
): NextResponse {
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
      } catch (error) {
        const a2aError =
          error instanceof A2AError
            ? error
            : A2AError.internalError(getErrorMessage(error, 'Streaming error'))
        const errorEnvelope = {
          jsonrpc: '2.0' as const,
          id: requestId,
          error: a2aError.toJSONRPCError(),
        }
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify(errorEnvelope)}\n\n`)
        )
      } finally {
        controller.close()
      }
    },
  })

  return new NextResponse(readable, { headers: SSE_HEADERS })
}

/**
 * GET - Returns the Agent Card (discovery document)
 */
export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<RouteParams> }) => {
    const { agentId } = a2aServeAgentParamsSchema.parse(await params)

    const result = await getServedAgentCard(agentId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.card, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=60',
        'X-Cache': result.cacheHit ? 'HIT' : 'MISS',
      },
    })
  }
)

/**
 * POST - Handle JSON-RPC requests via the A2A SDK transport handler
 */
export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<RouteParams> }) => {
    const { agentId } = a2aServeAgentParamsSchema.parse(await params)

    let body: unknown
    try {
      // boundary-raw-json: A2A JSON-RPC envelope is parsed and validated by the @a2a-js/sdk JsonRpcTransportHandler
      body = await request.json()
    } catch {
      return jsonRpcErrorResponse(null, A2AError.parseError('Invalid JSON body'), 400)
    }
    const requestId = extractJsonRpcId(body)

    const [agent] = await db
      .select({
        id: a2aAgent.id,
        name: a2aAgent.name,
        workflowId: a2aAgent.workflowId,
        workspaceId: a2aAgent.workspaceId,
        isPublished: a2aAgent.isPublished,
        authentication: a2aAgent.authentication,
      })
      .from(a2aAgent)
      .where(and(eq(a2aAgent.id, agentId), isNull(a2aAgent.archivedAt)))
      .limit(1)

    if (!agent) {
      return jsonRpcErrorResponse(
        requestId,
        new A2AError(A2A_SERVER_ERROR_CODE, 'Agent not found'),
        404
      )
    }
    if (!agent.isPublished) {
      return jsonRpcErrorResponse(
        requestId,
        new A2AError(A2A_SERVER_ERROR_CODE, 'Agent not published'),
        404
      )
    }

    const authSchemes = (agent.authentication as { schemes?: string[] })?.schemes || []
    const requiresAuth = !authSchemes.includes('none')
    let authenticatedUserId: string | null = null
    let authenticatedAuthType: AuthResult['authType']
    let authenticatedApiKeyType: AuthResult['apiKeyType']

    if (requiresAuth) {
      const auth = await checkHybridAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return jsonRpcErrorResponse(
          requestId,
          new A2AError(A2A_SERVER_ERROR_CODE, 'Unauthorized'),
          401
        )
      }
      authenticatedUserId = auth.userId
      authenticatedAuthType = auth.authType
      authenticatedApiKeyType = auth.apiKeyType

      if (auth.apiKeyType === 'workspace' && auth.workspaceId !== agent.workspaceId) {
        return jsonRpcErrorResponse(
          requestId,
          new A2AError(A2A_SERVER_ERROR_CODE, 'Access denied'),
          403
        )
      }

      const workspaceAccess = await checkWorkspaceAccess(agent.workspaceId, authenticatedUserId)
      if (!workspaceAccess.exists || !workspaceAccess.hasAccess) {
        return jsonRpcErrorResponse(
          requestId,
          new A2AError(A2A_SERVER_ERROR_CODE, 'Access denied'),
          403
        )
      }
    }

    const [wf] = await db
      .select({ isDeployed: workflow.isDeployed })
      .from(workflow)
      .where(and(eq(workflow.id, agent.workflowId), isNull(workflow.archivedAt)))
      .limit(1)

    if (!wf?.isDeployed) {
      return jsonRpcErrorResponse(
        requestId,
        new A2AError(A2A_SERVER_ERROR_CODE, 'Workflow is not deployed'),
        400
      )
    }

    const requestApiKey = request.headers.get('X-API-Key')
    const apiKey = authenticatedAuthType === AuthType.API_KEY ? requestApiKey : null
    const isPersonalApiKeyCaller =
      authenticatedAuthType === AuthType.API_KEY && authenticatedApiKeyType === 'personal'
    const callerFingerprint = getCallerFingerprint(request, authenticatedUserId)

    const billedUserId = await getWorkspaceBilledAccountUserId(agent.workspaceId)
    if (!billedUserId) {
      logger.error('Unable to resolve workspace billed account for A2A execution', {
        agentId: agent.id,
        workspaceId: agent.workspaceId,
      })
      return jsonRpcErrorResponse(
        requestId,
        A2AError.internalError('Unable to resolve billing account for this workspace'),
        500
      )
    }
    if (!(await isApiExecutionEntitled(billedUserId))) {
      return jsonRpcErrorResponse(
        requestId,
        new A2AError(A2A_SERVER_ERROR_CODE, API_EXECUTION_REQUIRES_PAID_PLAN_MESSAGE),
        402
      )
    }

    const executionUserId =
      isPersonalApiKeyCaller && authenticatedUserId ? authenticatedUserId : billedUserId

    const cardResult = await getServedAgentCard(agentId)
    if (!cardResult.ok) {
      return jsonRpcErrorResponse(
        requestId,
        new A2AError(A2A_SERVER_ERROR_CODE, cardResult.error),
        cardResult.status
      )
    }

    const handler = new SimA2ARequestHandler({
      agent: {
        id: agent.id,
        name: agent.name,
        workflowId: agent.workflowId,
        workspaceId: agent.workspaceId,
      },
      agentCard: cardResult.card,
      apiKey,
      executionUserId,
      callerFingerprint,
      requestSignal: request.signal,
    })

    const transport = new JsonRpcTransportHandler(handler)
    const result = await transport.handle(body)

    if (isAsyncIterable(result)) {
      return streamJsonRpc(result, requestId)
    }

    return NextResponse.json(result)
  }
)
