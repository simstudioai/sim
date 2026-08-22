import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import type { V2ErrorCode } from '@/lib/api/contracts/v2/error-codes'
import {
  V2_WORKFLOW_RUN_ID_HEADER,
  v2ExecuteWorkflowContract,
} from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import {
  admitOptionalV2Request,
  V2_PARSE_DEFAULTS,
  V2RouteInfrastructureError,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import type { V2ApiKeyPrincipal } from '@/lib/api/server/routes/v2-api-key-auth'
import { tryAdmit } from '@/lib/core/admission/gate'
import { ADMISSION_ERROR_DESCRIPTOR } from '@/lib/core/admission/transient-failure'
import type { ForbiddenDetailCode } from '@/lib/core/application'
import { generateRequestId } from '@/lib/core/utils/request'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  buildNextCallChain,
  parseCallChain,
  SIM_VIA_HEADER,
  validateCallChain,
} from '@/lib/execution/call-chain'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { executeWorkflowOperation } from '@/lib/workflows/application/execute-workflow'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  type ExecuteWorkflowServiceFailure,
  type ExecuteWorkflowServiceResult,
  executeWorkflowService,
} from '@/lib/workflows/executor/execute-service'
import {
  AGENT_STREAM_PROTOCOL_HEADER_LABEL,
  AGENT_STREAM_PROTOCOL_V1,
  clientAcceptsAgentStreamProtocol,
  hasAgentStreamPolicy,
} from '@/lib/workflows/streaming/agent-stream-protocol'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import { v2Data, v2Error } from '@/app/api/v2/lib/response'
import {
  PublicApiNotAllowedError,
  validatePublicApiAllowed,
} from '@/ee/access-control/utils/permission-check'

const logger = createLogger('V2WorkflowExecuteAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FAILURE_CODE_BY_STATUS: Record<number, V2ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'USAGE_LIMIT_EXCEEDED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  408: 'BAD_REQUEST',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  499: 'CLIENT_CLOSED_REQUEST',
  503: 'SERVICE_UNAVAILABLE',
}

function serviceFailureResponse(failure: ExecuteWorkflowServiceFailure) {
  const code = FAILURE_CODE_BY_STATUS[failure.statusCode] ?? 'INTERNAL_ERROR'
  const isRunIdConflict = failure.code === 'EXECUTION_ID_CONFLICT'
  const detailCode = isRunIdConflict ? 'RUN_ID_CONFLICT' : failure.code
  const headers: Record<string, string> = {}
  if (failure.retryAfterMs !== undefined) {
    headers['Retry-After'] = Math.max(1, Math.ceil(failure.retryAfterMs / 1000)).toString()
  }
  if (failure.executionId) {
    headers[V2_WORKFLOW_RUN_ID_HEADER] = failure.executionId
  }
  return v2Error(code, isRunIdConflict ? 'Run ID has already been used' : failure.message, {
    status: failure.statusCode,
    headers,
    /** An unconfirmed enqueue may already have started a run — reconcile on `runId`, never retry blind. */
    omitRetryAfter: failure.code === 'ASYNC_ENQUEUE_AMBIGUOUS',
    details:
      detailCode || failure.executionId
        ? {
            ...(detailCode ? { code: detailCode } : {}),
            ...(failure.executionId ? { runId: failure.executionId } : {}),
          }
        : undefined,
  })
}

/**
 * POST /api/v2/workflows/[id]/execute — syntactic sugar over
 * {@link executeWorkflowService}.
 *
 * - Auth: `X-API-Key` (personal/workspace) or the anonymous public-API path for
 *   workflows deployed with `isPublicApi` (actor = owner; sync/stream only).
 * - `async: true` (body flag — v2 has no mode headers) → 202
 *   `{ data: { runId, statusUrl } }`; poll the v2 runs resource.
 * - `stream: true` → SSE passthrough (no `{data}` envelope on event frames).
 * - Sync → 200 run resource with the status enum and structured error;
 *   an in-band run failure is `status: 'failed'`, never an HTTP error. A
 *   Response block's declared payload stays inside `output` — v2 never lets a
 *   workflow author control response status or headers on this origin.
 * - Rate limiting: keyed requests consume the shared request-rate bucket;
 *   execution preprocessing separately enforces the `sync`/`async` execution
 *   bucket, quota, billing, and concurrency checks.
 */
export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id: workflowId } = await context.params

    let userId: string
    let isPublicApiAccess = false
    let apiKeyPrincipal: V2ApiKeyPrincipal | undefined

    const admission = await admitOptionalV2Request(
      req,
      workflowOperations.execute,
      v2ApiKeyAuth,
      v2RateLimits.publicApi
    )
    if (!admission.success) return admission.response

    /**
     * Workflow-recursion guard. Mirrors the internal execute route: reject an
     * incoming chain that is already at the depth limit, then append this
     * workflow so the chain keeps growing across hops instead of resetting.
     */
    const incomingCallChain = parseCallChain(req.headers.get(SIM_VIA_HEADER))
    const callChainError = validateCallChain(incomingCallChain)
    if (callChainError) {
      logger.warn(`[${requestId}] Call chain rejected`, { workflowId, error: callChainError })
      return v2Error('CONFLICT', callChainError, { details: { code: 'CALL_CHAIN_DEPTH_EXCEEDED' } })
    }
    const callChain = buildNextCallChain(incomingCallChain, workflowId)

    if (admission.auth) {
      apiKeyPrincipal = admission.auth.principal
      userId = admission.auth.rolloutUserId
    } else {
      const [wf] = await db
        .select({
          isPublicApi: workflowTable.isPublicApi,
          isDeployed: workflowTable.isDeployed,
          userId: workflowTable.userId,
          workspaceId: workflowTable.workspaceId,
        })
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)

      if (!wf?.isPublicApi || !wf.isDeployed || !wf.workspaceId) {
        return v2Error('UNAUTHORIZED', 'Unauthorized')
      }
      try {
        await validatePublicApiAllowed(wf.userId, wf.workspaceId)
      } catch (err) {
        if (err instanceof PublicApiNotAllowedError) {
          return v2Error('UNAUTHORIZED', 'Unauthorized')
        }
        throw err
      }
      userId = wf.userId
      isPublicApiAccess = true
    }

    if (isPublicApiAccess) {
      const gate = await v2ApiGateError(userId)
      if (gate) return gate
    }

    const ticket = tryAdmit()
    if (!ticket) {
      return v2Error('RATE_LIMITED', 'Server is at capacity. Please retry shortly.', {
        headers: {
          'Retry-After': ADMISSION_ERROR_DESCRIPTOR.GATE_CAPACITY.retryAfterSeconds.toString(),
        },
      })
    }

    try {
      const parsed = await parseRequest(v2ExecuteWorkflowContract, req, context, {
        ...V2_PARSE_DEFAULTS,
        maxBodyBytes: 10 * 1024 * 1024,
      })
      if (!parsed.success) return parsed.response
      const body = parsed.data.body

      if (body.async && isPublicApiAccess) {
        return v2Error('BAD_REQUEST', 'Async execution requires an API key')
      }
      if (body.async && body.stream) {
        return v2Error('BAD_REQUEST', 'async and stream cannot be combined')
      }
      if (body.executionTimeoutSeconds !== undefined && !body.async) {
        return v2Error(
          'BAD_REQUEST',
          'executionTimeoutSeconds is supported only for async execution'
        )
      }
      if (
        body.async &&
        (body.selectedOutputs?.length ||
          body.includeThinking ||
          body.includeToolCalls ||
          body.includeFileBase64 !== undefined ||
          body.base64MaxBytes !== undefined)
      ) {
        return v2Error(
          'BAD_REQUEST',
          'Async execution does not support streaming or output-shaping options'
        )
      }
      const hasAgentStreamOptions = hasAgentStreamPolicy({
        includeThinking: body.includeThinking,
        includeToolCalls: body.includeToolCalls,
      })
      if (hasAgentStreamOptions && !body.stream) {
        return v2Error('BAD_REQUEST', 'includeThinking and includeToolCalls require stream: true')
      }
      if (hasAgentStreamOptions && !clientAcceptsAgentStreamProtocol(req.headers)) {
        return v2Error(
          'BAD_REQUEST',
          `includeThinking and includeToolCalls require the ${AGENT_STREAM_PROTOCOL_HEADER_LABEL}: ${AGENT_STREAM_PROTOCOL_V1} request header, which declares that the client understands agent-event frames.`
        )
      }

      /** Caller-supplied run IDs are a keyed-caller feature; anonymous callers must not probe the claim table. */
      let requestedExecutionId: string | undefined
      const runIdHeader = parsed.data.headers['x-run-id']
      if (runIdHeader !== undefined && !isPublicApiAccess) {
        requestedExecutionId = runIdHeader
      }

      let result: ExecuteWorkflowServiceResult
      if (apiKeyPrincipal) {
        result = await executeWorkflowOperation.execute({
          principal: apiKeyPrincipal,
          input: {
            workflowId,
            requestId,
            input: body.input ?? {},
            executionId: requestedExecutionId,
            includeFileBase64: body.includeFileBase64,
            base64MaxBytes: body.base64MaxBytes,
            selectedOutputs: body.selectedOutputs,
            requestedTimeoutSeconds: body.executionTimeoutSeconds,
            abortSignal: req.signal,
            mode: body.async ? 'async' : body.stream ? 'stream' : 'sync',
            requestHeaders: req.headers,
            includeThinking: body.includeThinking,
            includeToolCalls: body.includeToolCalls,
            callChain,
          },
          request: req,
        })
      } else {
        const workflowAuthorization = await authorizeWorkflowByWorkspacePermission({
          workflowId,
          userId,
          action: 'read',
        })
        if (!workflowAuthorization.allowed || !workflowAuthorization.workflow) {
          if (workflowAuthorization.status === 404) {
            return v2Error('NOT_FOUND', 'Workflow not found')
          }
          if (workflowAuthorization.status === 403) {
            return v2Error('FORBIDDEN', 'Insufficient workspace permissions', {
              details: { code: 'INSUFFICIENT_WORKSPACE_ROLE' satisfies ForbiddenDetailCode },
            })
          }
          throw new Error(
            `Unexpected workflow authorization status: ${workflowAuthorization.status}`
          )
        }
        result = await executeWorkflowService({
          workflowId,
          userId,
          isPublicApiAccess,
          input: body.input ?? {},
          triggerType: 'api',
          requestId,
          workflowRecord: workflowAuthorization.workflow,
          includeFileBase64: body.includeFileBase64,
          base64MaxBytes: body.base64MaxBytes,
          selectedOutputs: body.selectedOutputs,
          rateLimitCounter: 'sync',
          abortSignal: req.signal,
          mode: body.stream ? 'stream' : 'sync',
          requestHeaders: req.headers,
          includeThinking: body.includeThinking,
          includeToolCalls: body.includeToolCalls,
          callChain,
        })
      }

      if (!result.ok) {
        return serviceFailureResponse(result.failure)
      }

      if ('stream' in result) {
        // SSE: pass the stream through byte-for-byte with its own headers.
        return result.stream
      }

      if ('queued' in result) {
        return v2Data(
          {
            runId: result.executionId,
            statusUrl: `${getBaseUrl()}/api/v2/workflows/${workflowId}/runs/${result.executionId}`,
          },
          { status: 202, headers: { [V2_WORKFLOW_RUN_ID_HEADER]: result.executionId } }
        )
      }

      if (result.aborted === 'client') {
        return v2Error('CLIENT_CLOSED_REQUEST', 'Client cancelled request', {
          details: { runId: result.executionId },
        })
      }

      return v2Data(
        {
          runId: result.executionId,
          workflowId: result.workflowId,
          status: result.status,
          output: result.output ?? null,
          error: result.error,
          startedAt: result.startedAt,
          endedAt: result.endedAt,
          durationMs: result.durationMs,
        },
        { headers: { [V2_WORKFLOW_RUN_ID_HEADER]: result.executionId } }
      )
    } catch (error) {
      const classified = v2WorkflowErrorPolicies.concealWorkflowAuthorization.render(error)
      if (classified) return classified
      logger.error(`[${requestId}] v2 execute failed`, {
        workflowId,
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    } finally {
      ticket.release()
    }
  },
  {
    unhandledErrorResponse: ({ error }) =>
      error instanceof V2RouteInfrastructureError
        ? v2Error('SERVICE_UNAVAILABLE', 'Service temporarily unavailable')
        : v2Error('INTERNAL_ERROR', 'Internal server error'),
  }
)
