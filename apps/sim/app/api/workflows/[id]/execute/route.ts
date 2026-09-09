import type { WorkflowExecutionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { BlockState } from '@sim/workflow-types/workflow'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  executeWorkflowBodySchema,
  executeWorkflowHeadersSchema,
  executionIdSchema,
  WORKFLOW_EXECUTION_ID_HEADER,
  WORKFLOW_EXECUTION_TIMEOUT_SECONDS_HEADER,
} from '@/lib/api/contracts/workflows'
import { PERSONAL_KEY_DENIED, WORKSPACE_KEY_SCOPE_DENIED } from '@/lib/api-key/policy-messages'
import { AuthType, checkHybridAuth, hasExternalApiCredentials } from '@/lib/auth/hybrid'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  getWorkspaceBilledAccountUserId,
  requireBillingAttributionHeader,
} from '@/lib/billing/core/billing-attribution'
import {
  claimWorkflowToolExecution,
  getAsyncToolCall,
  getRunSegment,
  releaseWorkflowToolExecutionClaim,
} from '@/lib/copilot/async-runs/repository'
import { COPILOT_WORKFLOW_EXECUTION_CONFLICT_CODE } from '@/lib/copilot/constants'
import { CopilotDegradedReason } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { recordDegraded } from '@/lib/copilot/request/metrics'
import {
  ASYNC_WORKFLOW_DEPLOYMENT_ERRORS,
  type CopilotWorkflowToolBindingResult,
  classifyWorkflowToolBinding,
} from '@/lib/copilot/tools/workflow-tools'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import {
  createTimeoutAbortController,
  getTimeoutErrorMessage,
  isTimeoutAbortReason,
  isTimeoutError,
} from '@/lib/core/execution-limits'
import { isCrossSiteSessionRequest } from '@/lib/core/security/same-origin'
import { generateRequestId } from '@/lib/core/utils/request'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  PayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  buildNextCallChain,
  parseCallChain,
  SIM_VIA_HEADER,
  validateCallChain,
} from '@/lib/execution/call-chain'
import {
  createExecutionEventWriter,
  flushExecutionStreamReplayBuffer,
  initializeExecutionStreamMeta,
  markExecutionStreamTerminal,
  setExecutionActiveBlockStarts,
  type TerminalExecutionStreamStatus,
} from '@/lib/execution/event-buffer'
import {
  INTERNAL_EXECUTION_DEADLINE_HEADER,
  parseExecutionDeadlineHeader,
} from '@/lib/execution/execution-deadline-header'
import { processInputFileFields } from '@/lib/execution/files'
import {
  registerManualExecutionAborter,
  unregisterManualExecutionAborter,
} from '@/lib/execution/manual-cancellation'
import { containsLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { compactBlockLogs, compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import {
  type PreprocessExecutionSuccess,
  preprocessExecution,
  WORKFLOW_NOT_DEPLOYED_CODE,
} from '@/lib/execution/preprocessing'
import {
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_TOOL_METADATA_RESPONSE_HEADER,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
  requestsPrivateToolMetadata,
} from '@/lib/execution/private-tool-metadata'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import {
  MAX_MCP_WORKFLOW_RESPONSE_BYTES,
  MCP_TOOL_BRIDGE_ACTOR_HEADER,
  MCP_TOOL_BRIDGE_HEADER,
} from '@/lib/mcp/constants'
import {
  cleanupExecutionBase64Cache,
  hydrateUserFilesWithBase64,
} from '@/lib/uploads/utils/user-file-base64.server'
import { getCustomBlockRowsForWorkspace } from '@/lib/workflows/custom-blocks/operations'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import { enqueueWorkflowExecution } from '@/lib/workflows/executor/enqueue-execution'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import {
  type BlockStartedData,
  type ExecutionEvent,
  encodeSSEEvent,
  getBlockInvocationKey,
  LIVE_ONLY_EXECUTION_EVENT_TYPES,
} from '@/lib/workflows/executor/execution-events'
import {
  claimExecutionId,
  type ExecutionIdClaim,
  hasDurableExecutionOwner,
  releaseExecutionIdClaim,
} from '@/lib/workflows/executor/execution-id-claim'
import {
  INVALID_WORKFLOW_INPUT_PROVENANCE_ERROR,
  resolveWorkflowInputSecretProvenance,
} from '@/lib/workflows/executor/input-secret-provenance'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import {
  loadDeployedWorkflowState,
  loadWorkflowDeploymentVersionState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import {
  AGENT_STREAM_PROTOCOL_HEADER_LABEL,
  AGENT_STREAM_PROTOCOL_V1,
  clientAcceptsAgentStreamProtocol,
  hasAgentStreamPolicy,
  shouldEmitAgentStreamEvents,
} from '@/lib/workflows/streaming/agent-stream-protocol'
import {
  forwardAgentStreamToExecutionEvents,
  shouldForwardAnswerTextFromSink,
} from '@/lib/workflows/streaming/forward-agent-stream-events'
import { resolveOutputSelectors } from '@/lib/workflows/streaming/resolve-output-selectors'
import {
  agentStreamProtocolResponseHeaders,
  createStreamingResponse,
} from '@/lib/workflows/streaming/streaming'
import { createHttpResponseFromBlock, workflowHasResponseBlock } from '@/lib/workflows/utils'
import { getWorkspaceBillingSettings } from '@/lib/workspaces/utils'
import { withCustomBlockOverlay } from '@/blocks/custom/server-overlay'
import {
  PublicApiNotAllowedError,
  validatePublicApiAllowed,
} from '@/ee/access-control/utils/permission-check'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type {
  BlockCompletionCallbackData,
  ChildWorkflowContext,
  ExecutionMetadata,
  IterationContext,
  SerializableExecutionState,
} from '@/executor/execution/types'
import type { BlockLog, NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import { getExecutionErrorStatus, hasExecutionResult } from '@/executor/utils/errors'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'
import { Serializer } from '@/serializer'
import { CORE_TRIGGER_TYPES, type CoreTriggerType } from '@/stores/logs/filters/types'

const logger = createLogger('WorkflowExecuteAPI')
const MAX_WORKFLOW_EXECUTE_BODY_BYTES = 10 * 1024 * 1024
const SERVER_EXECUTION_ID_CLAIM_ATTEMPTS = 3

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function resolveCopilotWorkflowToolBinding(params: {
  toolCallId: string
  userId: string
  workflowId: string
}): Promise<CopilotWorkflowToolBindingResult> {
  const toolCall = await getAsyncToolCall(params.toolCallId)
  const run = toolCall ? await getRunSegment(toolCall.runId) : null
  return classifyWorkflowToolBinding({
    toolCall,
    run,
    userId: params.userId,
    workflowId: params.workflowId,
  })
}

function createExecutionJsonResponse(
  body: Record<string, unknown>,
  init: ResponseInit | undefined,
  includePrivateProvenance: boolean,
  loggingSession?: LoggingSession
): NextResponse {
  if (!includePrivateProvenance) {
    return NextResponse.json(body, init)
  }

  const headers = new Headers(init?.headers)
  headers.set(PRIVATE_TOOL_METADATA_RESPONSE_HEADER, RESOLVED_SECRET_PROVENANCE_METADATA_V1)
  return NextResponse.json(
    {
      ...body,
      [RESOLVED_SECRET_PROVENANCE_FIELD]:
        loggingSession?.exportResolvedSecretTraceProvenanceForValue(body) ?? {
          version: 1,
          complete: false,
          entries: [],
        },
    },
    { ...init, headers }
  )
}

async function compactRoutePayload<T>(
  value: T,
  context: {
    workspaceId?: string
    workflowId?: string
    executionId?: string
    userId?: string
    preserveUserFileBase64?: boolean
    preserveRoot?: boolean
    rejectLargeValues?: boolean
    rejectLargeValueLabel?: string
    thresholdBytes?: number
  }
): Promise<T> {
  return compactExecutionPayload(value, { ...context, requireDurable: true })
}

async function compactWorkflowResponseOutput<T>(
  value: T,
  context: {
    workspaceId?: string
    workflowId?: string
    executionId?: string
    userId?: string
    rejectLargeInlineOutput: boolean
  }
): Promise<T> {
  const compacted = await compactRoutePayload(value, {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    executionId: context.executionId,
    userId: context.userId,
    preserveUserFileBase64: true,
    preserveRoot: !context.rejectLargeInlineOutput,
    rejectLargeValues: context.rejectLargeInlineOutput,
    rejectLargeValueLabel: 'Workflow execution response',
    thresholdBytes: context.rejectLargeInlineOutput ? MAX_MCP_WORKFLOW_RESPONSE_BYTES : undefined,
  })

  if (context.rejectLargeInlineOutput && containsLargeValueRef(compacted)) {
    throw new PayloadSizeLimitError({
      label: 'Workflow execution response',
      maxBytes: MAX_MCP_WORKFLOW_RESPONSE_BYTES,
      observedBytes: MAX_MCP_WORKFLOW_RESPONSE_BYTES + 1,
    })
  }

  return compacted
}

async function readExecuteRequestBody(req: NextRequest): Promise<unknown> {
  assertContentLengthWithinLimit(
    req.headers,
    MAX_WORKFLOW_EXECUTE_BODY_BYTES,
    'Workflow execution request body'
  )
  const buffer = await readStreamToBufferWithLimit(req.body, {
    maxBytes: MAX_WORKFLOW_EXECUTE_BODY_BYTES,
    label: 'Workflow execution request body',
    signal: req.signal,
  })
  if (buffer.byteLength === 0) return {}
  return JSON.parse(buffer.toString('utf-8'))
}

function clientCancelledResponse(): NextResponse {
  return NextResponse.json({ success: false, error: 'Client cancelled request' }, { status: 499 })
}

function executionTimedOutResponse(timeoutMs?: number): NextResponse {
  return NextResponse.json(
    { success: false, error: getTimeoutErrorMessage(null, timeoutMs) },
    { status: 408 }
  )
}

function payloadTooLargeResponse(message = 'Workflow execution response exceeds maximum size') {
  return NextResponse.json(
    { success: false, error: message, code: 'workflow_response_too_large' },
    { status: 413 }
  )
}

async function resolveOutputIds(
  selectedOutputs: string[] | undefined,
  blocks: Record<string, BlockState>
): Promise<string[] | undefined> {
  return resolveOutputSelectors({
    selectedOutputs,
    currentBlocks: blocks,
  })
}

function bindRequestAbort(
  requestSignal: AbortSignal,
  timeoutController: ReturnType<typeof createTimeoutAbortController>
): { isRequestAborted: () => boolean; cleanup: () => void } {
  let requestAborted = false
  const abortFromRequest = () => {
    requestAborted = true
    timeoutController.abort()
  }

  if (requestSignal.aborted) {
    abortFromRequest()
  } else {
    requestSignal.addEventListener('abort', abortFromRequest, { once: true })
  }

  return {
    isRequestAborted: () => requestAborted || requestSignal.aborted,
    cleanup: () => requestSignal.removeEventListener('abort', abortFromRequest),
  }
}

type AsyncExecutionParams = {
  requestId: string
  workflowId: string
  principal: WorkflowExecutionPrincipal
  userId: string
  billingAttribution: BillingAttributionSnapshot
  workspaceId: string
  input: any
  triggerType: CoreTriggerType
  triggerBlockId?: string
  executionId: string
  copilotToolCallId?: string
  callChain?: string[]
  enforceCredentialAccess?: boolean
  isPublicApiAccess?: boolean
  executionTimeoutMs: number
  trustedInitialResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
}

interface AsyncExecutionResult {
  response: NextResponse
  retainExecutionClaim: boolean
}

type ValidatedPreprocessContext = {
  actorUserId: string
  workflow: PreprocessExecutionSuccess['workflowRecord']
  billingAttribution: BillingAttributionSnapshot
  workspaceId: string
}

function requirePreprocessedExecutionContext(
  result: PreprocessExecutionSuccess
): ValidatedPreprocessContext {
  if (!result.actorUserId) {
    throw new Error('Preprocessing succeeded without an actor user')
  }
  if (!result.workflowRecord) {
    throw new Error('Preprocessing succeeded without a workflow record')
  }
  if (!result.workflowRecord.workspaceId) {
    throw new Error('Preprocessing succeeded without a workflow workspace')
  }

  const billingAttribution = assertBillingAttributionSnapshot(result.billingAttribution)
  if (billingAttribution.actorUserId !== result.actorUserId) {
    throw new Error('Preprocessing actor does not match billing attribution')
  }
  if (billingAttribution.workspaceId !== result.workflowRecord.workspaceId) {
    throw new Error('Preprocessing workspace does not match billing attribution')
  }

  return {
    actorUserId: result.actorUserId,
    workflow: result.workflowRecord,
    billingAttribution,
    workspaceId: result.workflowRecord.workspaceId,
  }
}

async function handleAsyncExecution(params: AsyncExecutionParams): Promise<AsyncExecutionResult> {
  if (params.copilotToolCallId && (await checkNeedsRedeployment(params.workflowId))) {
    const deploymentError = ASYNC_WORKFLOW_DEPLOYMENT_ERRORS.stale
    await releaseExecutionSlot(params.executionId)
    return {
      response: NextResponse.json(
        {
          error: deploymentError.message,
          code: deploymentError.code,
        },
        { status: 409 }
      ),
      retainExecutionClaim: false,
    }
  }

  const enqueue = await enqueueWorkflowExecution(params)

  if (enqueue.outcome === 'rejected') {
    return {
      response: NextResponse.json({ error: 'Failed to queue async execution' }, { status: 500 }),
      retainExecutionClaim: false,
    }
  }

  if (enqueue.outcome === 'ambiguous') {
    return {
      response: NextResponse.json(
        {
          error: 'Async execution queue acceptance could not be confirmed',
          code: 'ASYNC_ENQUEUE_AMBIGUOUS',
          executionId: enqueue.executionId,
        },
        { status: 503, headers: { [WORKFLOW_EXECUTION_ID_HEADER]: enqueue.executionId } }
      ),
      retainExecutionClaim: true,
    }
  }

  return {
    response: NextResponse.json(
      {
        success: true,
        async: true,
        jobId: enqueue.jobId,
        executionId: enqueue.executionId,
        message: 'Workflow execution queued',
        statusUrl: `${getBaseUrl()}/api/jobs/${enqueue.jobId}`,
      },
      { status: 202 }
    ),
    retainExecutionClaim: true,
  }
}

/**
 * POST /api/workflows/[id]/execute
 *
 * Unified server-side workflow execution endpoint.
 * Supports both SSE streaming (for interactive/manual runs) and direct JSON responses (for background jobs).
 */
export const POST = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const isSessionRequest = req.headers.has('cookie') && !hasExternalApiCredentials(req.headers)
    if (isSessionRequest) {
      return handleExecutePost(req, params)
    }

    const ticket = tryAdmit()
    if (!ticket) {
      return admissionRejectedResponse()
    }

    try {
      return await handleExecutePost(req, params)
    } finally {
      ticket.release()
    }
  }
)

async function handleExecutePost(
  req: NextRequest,
  params: Promise<{ id: string }>
): Promise<NextResponse | Response> {
  const requestId = generateRequestId()
  const { id: workflowId } = await params
  let reqLogger = logger.withMetadata({ requestId, workflowId })

  const incomingCallChain = parseCallChain(req.headers.get(SIM_VIA_HEADER))
  const callChainError = validateCallChain(incomingCallChain)
  if (callChainError) {
    reqLogger.warn(`Call chain rejected: ${callChainError}`)
    return NextResponse.json({ error: callChainError }, { status: 409 })
  }
  const callChain = buildNextCallChain(incomingCallChain, workflowId)

  // Hoisted so the outer catch can release a reserved billing slot when a throw
  // after preprocessExecution exits before the stream takes over its release.
  let executionId = ''
  let executionIdClaim: ExecutionIdClaim | null = null
  let executionIdClaimCommitted = false
  let workflowToolClaimAcquired = false
  let copilotToolCallId: string | undefined

  try {
    const auth = await checkHybridAuth(req, { requireWorkflowId: false })

    // CSRF guard: reject session-cookie execution that is provably cross-site
    // (a different site driving the user's browser). same-origin and same-site
    // are allowed so multi-subdomain deployments (e.g. www.<domain> calling
    // <domain>) keep working. Scoped to session auth — API-key / public-API /
    // internal-JWT callers don't use cookies. Not a defense against a non-browser
    // client forging headers; that's covered by the credit/rate-limit gates.
    if (auth.success && auth.authType === AuthType.SESSION && isCrossSiteSessionRequest(req)) {
      reqLogger.warn('Rejected cross-site session-authenticated execute request')
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const executionModeHeader = req.headers.get('X-Execution-Mode')
    const isAsyncMode = executionModeHeader === 'async'
    const trustedDeadlineHeader =
      auth.success && auth.authType === AuthType.INTERNAL_JWT && !isAsyncMode
        ? req.headers.get(INTERNAL_EXECUTION_DEADLINE_HEADER)
        : null
    const inheritedExecutionDeadlineAt =
      trustedDeadlineHeader === null ? undefined : parseExecutionDeadlineHeader(req.headers)
    if (trustedDeadlineHeader !== null && inheritedExecutionDeadlineAt === undefined) {
      return NextResponse.json(
        { error: 'Invalid internal execution deadline header' },
        { status: 400 }
      )
    }
    const hasInheritedDeadlineExpired = () =>
      inheritedExecutionDeadlineAt !== undefined && Date.now() >= inheritedExecutionDeadlineAt
    const requestAbortResponse = () =>
      hasInheritedDeadlineExpired() ? executionTimedOutResponse() : clientCancelledResponse()
    if (hasInheritedDeadlineExpired()) {
      return executionTimedOutResponse()
    }

    const isMcpBridgeRequest =
      auth.authType === AuthType.INTERNAL_JWT && req.headers.get(MCP_TOOL_BRIDGE_HEADER) === 'true'
    const includePrivateTraceProvenance =
      auth.success &&
      auth.authType === AuthType.INTERNAL_JWT &&
      requestsPrivateToolMetadata(req.headers, RESOLVED_SECRET_PROVENANCE_METADATA_V1)
    const useMcpBridgeAuthenticatedUserAsActor =
      isMcpBridgeRequest && req.headers.get(MCP_TOOL_BRIDGE_ACTOR_HEADER) === 'authenticated-user'

    let userId: string
    let isPublicApiAccess = false

    if (!auth.success || !auth.userId) {
      const hasExplicitCredentials =
        req.headers.has('x-api-key') || req.headers.get('authorization')?.startsWith('Bearer ')
      if (hasExplicitCredentials) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
      }

      const [wf] = await db
        .select({
          isPublicApi: workflowTable.isPublicApi,
          isDeployed: workflowTable.isDeployed,
          workspaceId: workflowTable.workspaceId,
        })
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)

      if (!wf?.isPublicApi || !wf.isDeployed || !wf.workspaceId) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
      }

      /**
       * An anonymous public-API call has no caller, so it acts as the workspace
       * billing account — the identity preprocessing elects for exactly this
       * case. The workflow owner is only the personal-variable fallback, and a
       * public run resolves no personal variables at all, so gating on the
       * owner's governance config would fail a public endpoint the moment that
       * stored pointer's access lapsed.
       */
      const billedAccountUserId = await getWorkspaceBilledAccountUserId(wf.workspaceId)
      if (!billedAccountUserId) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
      }

      try {
        await validatePublicApiAllowed(billedAccountUserId, wf.workspaceId)
      } catch (err) {
        if (err instanceof PublicApiNotAllowedError) {
          return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
        }
        throw err
      }

      userId = billedAccountUserId
      isPublicApiAccess = true
    } else {
      userId = auth.userId
    }

    let body: any = {}
    try {
      body = await readExecuteRequestBody(req)
    } catch (error) {
      if (isPayloadSizeLimitError(error)) {
        reqLogger.warn('Workflow execution request body exceeded size limit', {
          maxBytes: error.maxBytes,
          observedBytes: error.observedBytes,
        })
        return NextResponse.json(
          { error: 'Workflow execution request body exceeds maximum size' },
          { status: 413 }
        )
      }
      if (req.signal.aborted) {
        return requestAbortResponse()
      }
      reqLogger.warn('Failed to parse request body', { error: toError(error).message })
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }

    const validation = executeWorkflowBodySchema.safeParse(body)
    if (!validation.success) {
      reqLogger.warn('Invalid request body:', validation.error.issues)
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: validation.error.issues.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      )
    }

    const headerValidation = executeWorkflowHeadersSchema.safeParse({
      [WORKFLOW_EXECUTION_ID_HEADER]: req.headers.get(WORKFLOW_EXECUTION_ID_HEADER) ?? undefined,
      [WORKFLOW_EXECUTION_TIMEOUT_SECONDS_HEADER]:
        req.headers.get(WORKFLOW_EXECUTION_TIMEOUT_SECONDS_HEADER) ?? undefined,
    })
    if (!headerValidation.success) {
      const invalidExecutionId = headerValidation.error.issues.some(
        (issue) => issue.path[0] === WORKFLOW_EXECUTION_ID_HEADER
      )
      const errorMessage = invalidExecutionId
        ? 'Invalid execution ID header'
        : 'Invalid execution timeout header'
      reqLogger.warn(errorMessage, {
        issues: headerValidation.error.issues,
      })
      return NextResponse.json(
        {
          error: errorMessage,
          details: headerValidation.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        { status: 400 }
      )
    }

    const defaultTriggerType =
      isPublicApiAccess || auth.authType === AuthType.API_KEY ? 'api' : 'manual'

    const {
      selectedOutputs,
      triggerType = defaultTriggerType,
      stream: streamParam,
      includeThinking: requestedIncludeThinking,
      includeToolCalls: requestedIncludeToolCalls,
      useDraftState,
      input: validatedInput,
      inputFromExecutionId,
      isClientSession = false,
      includeFileBase64,
      base64MaxBytes,
      workflowStateOverride,
      deploymentVersionId: admittedDeploymentVersionId,
      executionId: rawBodyExecutionId,
      copilotToolCallId: parsedCopilotToolCallId,
      triggerBlockId: parsedTriggerBlockId,
      startBlockId,
      stopAfterBlockId,
      runFromBlock: rawRunFromBlock,
      parentWorkspaceId,
    } = validation.data
    copilotToolCallId = parsedCopilotToolCallId
    const triggerBlockId = parsedTriggerBlockId ?? startBlockId
    const streamHeader = req.headers.get('X-Stream-Response') === 'true'
    const enableSSE = streamHeader || streamParam === true
    const requestedTimeoutSeconds = headerValidation.data[WORKFLOW_EXECUTION_TIMEOUT_SECONDS_HEADER]
    if (requestedTimeoutSeconds !== undefined && !isAsyncMode) {
      return NextResponse.json(
        { error: `${WORKFLOW_EXECUTION_TIMEOUT_SECONDS_HEADER} is supported only for async runs` },
        { status: 400 }
      )
    }
    if (admittedDeploymentVersionId && !isMcpBridgeRequest) {
      return NextResponse.json(
        { error: 'deploymentVersionId is reserved for internal MCP execution' },
        { status: 400 }
      )
    }
    const headerExecutionId = headerValidation.data[WORKFLOW_EXECUTION_ID_HEADER]
    let legacyBodyExecutionId: string | undefined
    if (!headerExecutionId && rawBodyExecutionId !== undefined) {
      const bodyExecutionIdValidation = executionIdSchema.safeParse(rawBodyExecutionId)
      if (!bodyExecutionIdValidation.success) {
        reqLogger.warn('Invalid legacy body execution ID', {
          issues: bodyExecutionIdValidation.error.issues,
        })
        return NextResponse.json(
          {
            error: 'Invalid request body',
            details: bodyExecutionIdValidation.error.issues.map((issue) => ({
              path: 'executionId',
              message: issue.message,
            })),
          },
          { status: 400 }
        )
      }
      legacyBodyExecutionId = bodyExecutionIdValidation.data
    }

    if (isPublicApiAccess && isClientSession) {
      return NextResponse.json(
        { error: 'Public API callers cannot set isClientSession' },
        { status: 400 }
      )
    }

    if (inputFromExecutionId && (isPublicApiAccess || auth.authType !== AuthType.SESSION)) {
      return NextResponse.json(
        { error: 'Stored execution input can only be reused by an authenticated session' },
        { status: 403 }
      )
    }

    if (inputFromExecutionId && validatedInput !== undefined) {
      return NextResponse.json(
        { error: 'Provide either input or inputFromExecutionId, not both' },
        { status: 400 }
      )
    }

    if (
      copilotToolCallId &&
      (auth.authType !== AuthType.SESSION ||
        !isClientSession ||
        triggerType !== 'copilot' ||
        (!isAsyncMode && !enableSSE))
    ) {
      return NextResponse.json(
        { error: 'Copilot tool execution binding is invalid for this request' },
        { status: 400 }
      )
    }

    if (auth.authType === 'api_key') {
      if (isClientSession) {
        return NextResponse.json(
          { error: 'API key callers cannot set isClientSession' },
          { status: 400 }
        )
      }

      if (workflowStateOverride) {
        return NextResponse.json(
          { error: 'API key callers cannot provide workflowStateOverride' },
          { status: 400 }
        )
      }

      if (useDraftState) {
        return NextResponse.json(
          { error: 'API key callers cannot execute draft workflow state' },
          { status: 400 }
        )
      }
    }

    // Resolve runFromBlock snapshot from executionId if needed
    let resolvedRunFromBlock:
      | {
          startBlockId: string
          sourceSnapshot: SerializableExecutionState
          sourceExecutionId?: string
        }
      | undefined
    if (rawRunFromBlock) {
      if (rawRunFromBlock.sourceSnapshot && auth.authType === 'api_key') {
        return NextResponse.json(
          { error: 'API key callers cannot provide runFromBlock.sourceSnapshot' },
          { status: 400 }
        )
      }

      if (rawRunFromBlock.executionId && (auth.authType === 'api_key' || isPublicApiAccess)) {
        return NextResponse.json(
          { error: 'External callers cannot resume from stored execution snapshots' },
          { status: 400 }
        )
      }

      if (rawRunFromBlock.executionId) {
        const { getExecutionStateForWorkflow, getLatestExecutionStateWithExecutionId } =
          await import('@/lib/workflows/executor/execution-state')
        const sourceExecution =
          rawRunFromBlock.executionId === 'latest'
            ? await getLatestExecutionStateWithExecutionId(workflowId)
            : {
                executionId: rawRunFromBlock.executionId,
                state: await getExecutionStateForWorkflow(rawRunFromBlock.executionId, workflowId),
              }
        const snapshot = sourceExecution?.state
        if (!snapshot) {
          if (rawRunFromBlock.sourceSnapshot && !isPublicApiAccess) {
            resolvedRunFromBlock = {
              startBlockId: rawRunFromBlock.startBlockId,
              sourceSnapshot: rawRunFromBlock.sourceSnapshot as SerializableExecutionState,
            }
          } else {
            return NextResponse.json(
              {
                error: `No execution state found for ${rawRunFromBlock.executionId === 'latest' ? 'workflow' : `execution ${rawRunFromBlock.executionId}`}. Run the full workflow first.`,
              },
              { status: 400 }
            )
          }
        } else {
          resolvedRunFromBlock = {
            startBlockId: rawRunFromBlock.startBlockId,
            sourceSnapshot: snapshot,
            sourceExecutionId: sourceExecution.executionId,
          }
        }
      } else if (rawRunFromBlock.sourceSnapshot && !isPublicApiAccess) {
        // Public API callers cannot inject arbitrary block state via sourceSnapshot.
        // They must use executionId to resume from a server-stored execution state.
        resolvedRunFromBlock = {
          startBlockId: rawRunFromBlock.startBlockId,
          sourceSnapshot: rawRunFromBlock.sourceSnapshot as SerializableExecutionState,
        }
      } else {
        return NextResponse.json(
          { error: 'runFromBlock requires either sourceSnapshot or executionId' },
          { status: 400 }
        )
      }
    }

    // For API key and internal JWT auth, the entire body is the input (except for our control fields)
    // For session auth, the input is explicitly provided in the input field
    let input = isMcpBridgeRequest
      ? validatedInput
      : isPublicApiAccess ||
          auth.authType === AuthType.API_KEY ||
          auth.authType === AuthType.INTERNAL_JWT
        ? (() => {
            const {
              selectedOutputs,
              triggerType,
              stream,
              useDraftState,
              inputFromExecutionId: _inputFromExecutionId,
              includeFileBase64,
              base64MaxBytes,
              workflowStateOverride,
              deploymentVersionId: _deploymentVersionId,
              triggerBlockId: _triggerBlockId,
              stopAfterBlockId: _stopAfterBlockId,
              runFromBlock: _runFromBlock,
              copilotToolCallId: _copilotToolCallId,
              workflowId: _workflowId, // Also exclude workflowId used for internal JWT auth
              parentWorkspaceId: _parentWorkspaceId,
              [PRIVATE_SECRET_PROVENANCE_FIELD]: _privateSecretProvenance,
              ...rest
            } = body
            return Object.keys(rest).length > 0 ? rest : validatedInput
          })()
        : validatedInput

    // Public API callers must not inject arbitrary workflow state overrides (code injection risk).
    // stopAfterBlockId and runFromBlock are safe — they control execution flow within the deployed state.
    const sanitizedWorkflowStateOverride = isPublicApiAccess ? undefined : workflowStateOverride

    // Public API callers always execute the deployed state, never the draft.
    const shouldUseDraftState = isPublicApiAccess
      ? false
      : isAsyncMode
        ? false
        : (useDraftState ?? auth.authType === AuthType.SESSION)
    const requiresWriteExecutionAccess = Boolean(
      useDraftState || workflowStateOverride || rawRunFromBlock
    )

    if (req.signal.aborted) {
      return requestAbortResponse()
    }

    if (
      isAsyncMode &&
      (body.useDraftState !== undefined ||
        body.workflowStateOverride !== undefined ||
        body.runFromBlock !== undefined ||
        body.stopAfterBlockId !== undefined ||
        body.selectedOutputs?.length ||
        body.includeFileBase64 !== undefined ||
        body.base64MaxBytes !== undefined)
    ) {
      return NextResponse.json(
        { error: 'Async execution does not support draft or override execution controls' },
        { status: 400 }
      )
    }

    const callerProvidedExecutionId = headerExecutionId ?? legacyBodyExecutionId
    executionId = callerProvidedExecutionId ?? generateId()
    reqLogger = reqLogger.withMetadata({ userId, executionId })

    reqLogger.info('Starting server-side execution', {
      hasInput: !!input,
      triggerType,
      authType: auth.authType,
      streamParam,
      streamHeader,
      enableSSE,
      isAsyncMode,
    })
    let loggingTriggerType: CoreTriggerType = 'manual'
    if (CORE_TRIGGER_TYPES.includes(triggerType as CoreTriggerType)) {
      loggingTriggerType = triggerType as CoreTriggerType
    }

    /**
     * Interactive sessions and personal keys preserve the authenticated human
     * as actor. Preprocessing resolves the workspace payer independently.
     */
    const useAuthenticatedUserAsActor =
      isClientSession ||
      (auth.authType === AuthType.API_KEY && auth.apiKeyType === 'personal') ||
      useMcpBridgeAuthenticatedUserAsActor

    // Authorization fetches the full workflow record and checks workspace permissions.
    // Run it first so we can pass the record to preprocessing (eliminates a duplicate DB query).
    const workflowAuthorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId,
      action: requiresWriteExecutionAccess ? 'write' : 'read',
    })
    if (!workflowAuthorization.allowed) {
      return NextResponse.json(
        { error: workflowAuthorization.message || 'Access denied' },
        { status: workflowAuthorization.status }
      )
    }

    const workflowWorkspaceId = workflowAuthorization.workflow?.workspaceId
    if (!workflowWorkspaceId) {
      reqLogger.error('Workflow authorization succeeded without a workspace')
      return NextResponse.json({ error: 'Invalid workflow execution context' }, { status: 500 })
    }
    let executionPrincipal: WorkflowExecutionPrincipal
    if (auth.principal) {
      executionPrincipal = auth.principal
    } else if (isPublicApiAccess) {
      executionPrincipal = {
        kind: 'system',
        serviceId: 'public_api',
        workspaceId: workflowWorkspaceId,
        workflowId,
      }
    } else if (auth.authType === AuthType.INTERNAL_JWT) {
      executionPrincipal = {
        kind: 'system',
        serviceId: 'internal',
        workspaceId: workflowWorkspaceId,
        workflowId,
      }
    } else {
      throw new Error('Authenticated workflow execution is missing its principal')
    }
    if (auth.authType === AuthType.API_KEY) {
      if (auth.apiKeyType === 'workspace' && auth.workspaceId !== workflowWorkspaceId) {
        return NextResponse.json({ error: WORKSPACE_KEY_SCOPE_DENIED }, { status: 403 })
      }

      if (auth.apiKeyType === 'personal') {
        const workspaceSettings = workflowWorkspaceId
          ? await getWorkspaceBillingSettings(workflowWorkspaceId)
          : null
        if (!workspaceSettings?.allowPersonalApiKeys) {
          return NextResponse.json({ error: PERSONAL_KEY_DENIED }, { status: 403 })
        }
      }
    }

    /**
     * Workflow-in-workflow invocations (e.g. the agent `workflow_executor`
     * tool) declare the parent execution's workspace. Reject execution when
     * the target workflow lives in a different workspace so a stale or
     * foreign workflow id cannot silently execute with the parent's context.
     * The error intentionally omits the target's workspace id.
     */
    if (parentWorkspaceId && workflowAuthorization.workflow?.workspaceId !== parentWorkspaceId) {
      reqLogger.warn('Blocked cross-workspace child workflow execution', {
        parentWorkspaceId,
      })
      return NextResponse.json(
        {
          error: `Child workflow ${workflowId} belongs to a different workspace and cannot be executed`,
        },
        { status: 403 }
      )
    }

    if (copilotToolCallId) {
      const binding = await resolveCopilotWorkflowToolBinding({
        toolCallId: copilotToolCallId,
        userId,
        workflowId,
      })
      if (!binding.ok) {
        // This rejection happens before any LoggingSession exists, so it leaves
        // no execution log and no workflow span — log the reason or it is
        // invisible everywhere except the browser console.
        // This rejection happens before a LoggingSession or any workflow span
        // exists, so the counter is the only place it becomes visible.
        recordDegraded(CopilotDegradedReason.BindingRejected)
        reqLogger.warn('Rejected Copilot workflow tool execution', {
          copilotToolCallId,
          workflowId,
          reason: binding.rejection.code,
        })
        return NextResponse.json(
          { error: binding.rejection.message, code: binding.rejection.code },
          { status: binding.rejection.statusCode }
        )
      }
    }

    if (inputFromExecutionId) {
      const { getExecutionInputForWorkflow } = await import(
        '@/lib/workflows/executor/execution-state'
      )
      const sourceExecution = await getExecutionInputForWorkflow(inputFromExecutionId, workflowId)
      if (!sourceExecution.found) {
        return NextResponse.json(
          { error: 'Source workflow execution was not found' },
          { status: 404 }
        )
      }
      input = sourceExecution.input
    }

    const inputProvenanceResolution = await resolveWorkflowInputSecretProvenance({
      headers: req.headers,
      payload: body,
      input,
      isInternalJwt: auth.authType === AuthType.INTERNAL_JWT,
      workspaceId: workflowWorkspaceId,
    })
    if (!inputProvenanceResolution.success) {
      return NextResponse.json({ error: INVALID_WORKFLOW_INPUT_PROVENANCE_ERROR }, { status: 400 })
    }
    const trustedInitialResolvedSecretTraceProvenance = inputProvenanceResolution.provenance

    /**
     * External callers may not override the trigger type because manual and chat
     * executions bypass the API rate-limit path.
     */
    if (
      (auth.authType === AuthType.API_KEY || isPublicApiAccess) &&
      body.triggerType !== undefined &&
      body.triggerType !== 'api'
    ) {
      return NextResponse.json(
        { error: 'External callers cannot override triggerType' },
        { status: 400 }
      )
    }

    const upstreamBillingAttribution =
      auth.authType === AuthType.INTERNAL_JWT && workflowAuthorization.workflow?.workspaceId
        ? requireBillingAttributionHeader(req.headers, {
            actorUserId: userId,
            workspaceId: workflowAuthorization.workflow.workspaceId,
          })
        : undefined

    if (req.signal.aborted) {
      return requestAbortResponse()
    }

    try {
      for (let attempt = 1; attempt <= SERVER_EXECUTION_ID_CLAIM_ATTEMPTS; attempt++) {
        executionIdClaim = await claimExecutionId(executionId)
        if (executionIdClaim || callerProvidedExecutionId) {
          break
        }

        if (attempt < SERVER_EXECUTION_ID_CLAIM_ATTEMPTS) {
          executionId = generateId()
          reqLogger = reqLogger.withMetadata({ executionId })
        }
      }
    } catch (error) {
      reqLogger.error('Failed to claim workflow execution ID', {
        error: getErrorMessage(error),
      })
      return NextResponse.json(
        { error: 'Workflow execution identity is temporarily unavailable' },
        { status: 503 }
      )
    }

    if (!executionIdClaim) {
      if (callerProvidedExecutionId) {
        return NextResponse.json(
          {
            error: 'Execution ID has already been used',
            code: 'EXECUTION_ID_CONFLICT',
            executionId,
          },
          { status: 409 }
        )
      }

      reqLogger.error('Failed to allocate a unique server execution ID')
      return NextResponse.json(
        { error: 'Unable to allocate workflow execution identity' },
        { status: 503 }
      )
    }

    if (copilotToolCallId) {
      const boundToolCall = await claimWorkflowToolExecution(copilotToolCallId, executionId)
      if (!boundToolCall) {
        reqLogger.warn('Rejected duplicate Copilot workflow execution', {
          copilotToolCallId,
          attemptedExecutionId: executionId,
        })
        return NextResponse.json(
          {
            error: 'Copilot workflow tool is already bound to another execution',
            code: COPILOT_WORKFLOW_EXECUTION_CONFLICT_CODE,
          },
          { status: 409 }
        )
      }
      workflowToolClaimAcquired = true
    }

    const loggingSession = new LoggingSession(
      workflowId,
      executionId,
      loggingTriggerType,
      requestId
    )
    if (copilotToolCallId) {
      loggingSession.setTrustedExecutionCorrelation({
        executionId,
        requestId,
        source: 'workflow',
        workflowId,
        triggerType,
        copilotToolCallId,
      })
    }

    /** The pre-fetched record avoids a redundant initial workflow lookup. */
    const preprocessResult = await preprocessExecution({
      workflowId,
      userId,
      triggerType: loggingTriggerType,
      executionId,
      requestId,
      checkDeployment: !shouldUseDraftState,
      loggingSession,
      useAuthenticatedUserAsActor,
      workflowRecord: workflowAuthorization.workflow ?? undefined,
      billingAttribution: upstreamBillingAttribution,
      executionType: isAsyncMode ? 'async' : 'sync',
      requestedTimeoutSeconds,
      ...(inheritedExecutionDeadlineAt !== undefined
        ? { executionDeadlineAt: inheritedExecutionDeadlineAt }
        : {}),
    })

    if (!preprocessResult.success) {
      const preprocessError = preprocessResult.error
      if (isAsyncMode && copilotToolCallId && preprocessError.code === WORKFLOW_NOT_DEPLOYED_CODE) {
        const deploymentError = ASYNC_WORKFLOW_DEPLOYMENT_ERRORS.missing
        await releaseExecutionSlot(executionId)
        return NextResponse.json(
          { error: deploymentError.message, code: deploymentError.code },
          { status: preprocessError.statusCode }
        )
      }
      return NextResponse.json(
        { error: preprocessError.message },
        { status: preprocessError.statusCode }
      )
    }

    // Preprocessing reserved an admission slot (released when the LoggingSession
    // finalizes). Any path that exits before execution starts must release it
    // here, or the slot leaks until its TTL and wrongly throttles later runs.
    if (hasInheritedDeadlineExpired()) {
      await releaseExecutionSlot(executionId)
      return executionTimedOutResponse()
    }
    if (req.signal.aborted) {
      await releaseExecutionSlot(executionId)
      return requestAbortResponse()
    }

    let validatedContext: ValidatedPreprocessContext
    try {
      validatedContext = requirePreprocessedExecutionContext(preprocessResult)
    } catch (error) {
      reqLogger.error('Preprocessing returned an invalid execution context', {
        error: getErrorMessage(error),
      })
      await releaseExecutionSlot(executionId)
      return NextResponse.json(
        { error: 'Invalid execution context returned by preprocessing' },
        { status: 500 }
      )
    }
    const { actorUserId, workflow, billingAttribution, workspaceId } = validatedContext
    reqLogger = reqLogger.withMetadata({ workspaceId, userId: actorUserId })

    reqLogger.info('Preprocessing passed')

    const getEffectiveSyncTimeoutMs = () =>
      inheritedExecutionDeadlineAt === undefined
        ? preprocessResult.executionTimeout.sync
        : Math.max(1, inheritedExecutionDeadlineAt - Date.now())

    if (isAsyncMode) {
      const asyncResult = await handleAsyncExecution({
        requestId,
        workflowId,
        principal: executionPrincipal,
        userId: actorUserId,
        billingAttribution,
        workspaceId,
        input,
        triggerType: loggingTriggerType,
        triggerBlockId,
        executionId,
        copilotToolCallId,
        callChain,
        enforceCredentialAccess: useAuthenticatedUserAsActor,
        isPublicApiAccess,
        executionTimeoutMs: preprocessResult.executionTimeout.async,
        trustedInitialResolvedSecretTraceProvenance,
      })
      executionIdClaimCommitted = asyncResult.retainExecutionClaim
      return asyncResult.response
    }

    let cachedWorkflowData: {
      blocks: Record<string, any>
      edges: any[]
      loops: Record<string, any>
      parallels: Record<string, any>
      deploymentVersionId?: string
      variables?: Record<string, any>
    } | null = null

    let processedInput = input
    try {
      if (req.signal.aborted) {
        await releaseExecutionSlot(executionId)
        return requestAbortResponse()
      }
      const workflowData = shouldUseDraftState
        ? await loadWorkflowFromNormalizedTables(workflowId)
        : admittedDeploymentVersionId
          ? await loadWorkflowDeploymentVersionState(
              workflowId,
              admittedDeploymentVersionId,
              workspaceId
            )
          : await loadDeployedWorkflowState(workflowId, workspaceId)

      if (req.signal.aborted) {
        await releaseExecutionSlot(executionId)
        return requestAbortResponse()
      }

      if (workflowData) {
        const deployedVariables =
          !shouldUseDraftState && 'variables' in workflowData
            ? (workflowData as any).variables
            : undefined

        cachedWorkflowData = {
          blocks: workflowData.blocks,
          edges: workflowData.edges,
          loops: workflowData.loops || {},
          parallels: workflowData.parallels || {},
          deploymentVersionId:
            !shouldUseDraftState && 'deploymentVersionId' in workflowData
              ? (workflowData.deploymentVersionId as string)
              : undefined,
          variables: deployedVariables,
        }

        // Custom blocks resolve only inside the org overlay; wrap this pre-execution
        // serialize (used for input file-field discovery) the same way the core does.
        const customBlockRows = await getCustomBlockRowsForWorkspace(workspaceId)
        const serializedWorkflow = await withCustomBlockOverlay(customBlockRows, async () =>
          new Serializer().serializeWorkflow(
            workflowData.blocks,
            workflowData.edges,
            workflowData.loops,
            workflowData.parallels,
            false
          )
        )

        const executionContext = {
          workspaceId,
          workflowId,
          executionId,
        }

        processedInput = await processInputFileFields(
          input,
          serializedWorkflow.blocks,
          executionContext,
          requestId,
          actorUserId
        )
      }
    } catch (fileError) {
      reqLogger.error('Failed to process input file fields:', fileError)

      executionIdClaimCommitted = await loggingSession.safeStart({
        userId: actorUserId,
        billingAttribution,
        workspaceId,
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message: `File processing failed: ${getErrorMessage(fileError, 'Unable to process input files')}`,
          stackTrace: fileError instanceof Error ? fileError.stack : undefined,
        },
        traceSpans: [],
      })

      return NextResponse.json(
        {
          error: `File processing failed: ${getErrorMessage(fileError, 'Unable to process input files')}`,
        },
        { status: 400 }
      )
    }

    const effectiveWorkflowStateOverride =
      // double-cast-allowed: workflowStateSchema is structurally a supertype of the executor's reactflow-typed override (edges[].style is Record<string, unknown> vs CSSProperties); validated bodies carry store-shaped values so the runtime shape matches
      (sanitizedWorkflowStateOverride as unknown as ExecutionMetadata['workflowStateOverride']) ||
      cachedWorkflowData ||
      undefined
    const largeValueExecutionIds = [executionId]
    const largeValueKeys: string[] = []
    const fileKeys: string[] = []
    const allowLargeValueWorkflowScope = Boolean(
      resolvedRunFromBlock?.sourceSnapshot && !resolvedRunFromBlock.sourceExecutionId
    )

    if (!enableSSE) {
      reqLogger.info('Using non-SSE execution (direct JSON response)')
      const metadata: ExecutionMetadata = {
        requestId,
        executionId,
        workflowId,
        workspaceId,
        userId: actorUserId,
        principal: executionPrincipal,
        billingAttribution,
        sessionUserId: isClientSession ? userId : undefined,
        workflowUserId: workflow.userId,
        triggerType,
        triggerBlockId,
        useDraftState: shouldUseDraftState,
        startTime: new Date().toISOString(),
        isClientSession,
        enforceCredentialAccess: useAuthenticatedUserAsActor,
        isPublicApiAccess,
        workflowStateOverride: effectiveWorkflowStateOverride,
        largeValueExecutionIds,
        largeValueKeys,
        fileKeys,
        allowLargeValueWorkflowScope,
        callChain,
        executionMode: 'sync',
      }

      const executionVariables = cachedWorkflowData?.variables ?? workflow.variables ?? {}

      const timeoutController = createTimeoutAbortController(getEffectiveSyncTimeoutMs())
      const didExecutionTimeOut = (error?: unknown) =>
        timeoutController.isTimedOut() ||
        hasInheritedDeadlineExpired() ||
        isTimeoutAbortReason(timeoutController.signal.reason) ||
        isTimeoutAbortReason(req.signal.reason) ||
        isTimeoutError(error)
      const requestAbort = bindRequestAbort(req.signal, timeoutController)
      const shouldRejectLargeInlineOutput = isMcpBridgeRequest
      const workflowResponseCompaction = {
        workspaceId,
        workflowId,
        executionId,
        userId: actorUserId,
        rejectLargeInlineOutput: shouldRejectLargeInlineOutput,
      }

      try {
        const snapshot = new ExecutionSnapshot(
          metadata,
          workflow,
          processedInput,
          executionVariables,
          selectedOutputs
        )

        const result = await executeWorkflowCore({
          snapshot,
          callbacks: {},
          loggingSession,
          includeFileBase64,
          base64MaxBytes,
          stopAfterBlockId,
          runFromBlock: resolvedRunFromBlock,
          abortSignal: timeoutController.signal,
          trustedInitialResolvedSecretTraceProvenance,
        })

        await handlePostExecutionPauseState({ result, workflowId, executionId, loggingSession })

        if (
          result.status === 'cancelled' &&
          requestAbort.isRequestAborted() &&
          !didExecutionTimeOut()
        ) {
          reqLogger.info('Non-SSE execution cancelled by client disconnect')
          await loggingSession.markAsFailed('Client cancelled request')
          return clientCancelledResponse()
        }

        if (result.status === 'cancelled' && didExecutionTimeOut() && timeoutController.timeoutMs) {
          const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
          reqLogger.info('Non-SSE execution timed out', {
            timeoutMs: timeoutController.timeoutMs,
          })
          await loggingSession.markAsFailed(timeoutErrorMessage)
          const compactResultOutput = await compactWorkflowResponseOutput(
            result.output,
            workflowResponseCompaction
          )

          return createExecutionJsonResponse(
            {
              success: false,
              output: compactResultOutput,
              error: timeoutErrorMessage,
              metadata: result.metadata
                ? {
                    duration: result.metadata.duration,
                    startTime: result.metadata.startTime,
                    endTime: result.metadata.endTime,
                  }
                : undefined,
            },
            { status: 408 },
            includePrivateTraceProvenance,
            loggingSession
          )
        }

        const outputLargeValueKeys = result.metadata?.largeValueKeys ?? largeValueKeys
        const outputFileKeys = result.metadata?.fileKeys ?? fileKeys

        const outputWithBase64 =
          includeFileBase64 && !shouldRejectLargeInlineOutput
            ? ((await hydrateUserFilesWithBase64(result.output, {
                requestId,
                workspaceId,
                workflowId,
                executionId,
                largeValueExecutionIds,
                largeValueKeys: outputLargeValueKeys,
                fileKeys: outputFileKeys,
                allowLargeValueWorkflowScope,
                userId: actorUserId,
                principal: executionPrincipal,
                maxBytes: base64MaxBytes,
                preserveLargeValueMetadata: true,
              })) as NormalizedBlockOutput)
            : result.output

        if (
          !isMcpBridgeRequest &&
          auth.authType !== AuthType.INTERNAL_JWT &&
          workflowHasResponseBlock(result)
        ) {
          const compactResponseBlockOutput = await compactWorkflowResponseOutput(
            outputWithBase64,
            workflowResponseCompaction
          )
          return await createHttpResponseFromBlock(
            { ...result, output: compactResponseBlockOutput },
            {
              workspaceId,
              workflowId,
              executionId,
              largeValueExecutionIds,
              largeValueKeys: outputLargeValueKeys,
              fileKeys: outputFileKeys,
              userId: actorUserId,
              allowLargeValueWorkflowScope,
            }
          )
        }

        const compactOutput = await compactWorkflowResponseOutput(
          outputWithBase64,
          workflowResponseCompaction
        )

        const filteredResult = {
          success: result.success,
          executionId,
          output: compactOutput,
          error: result.error,
          metadata: result.metadata
            ? {
                duration: result.metadata.duration,
                startTime: result.metadata.startTime,
                endTime: result.metadata.endTime,
              }
            : undefined,
        }

        return createExecutionJsonResponse(
          filteredResult,
          undefined,
          includePrivateTraceProvenance,
          loggingSession
        )
      } catch (error: unknown) {
        const executionTimedOut = didExecutionTimeOut(error)
        const errorMessage = executionTimedOut
          ? getTimeoutErrorMessage(error, timeoutController.timeoutMs)
          : getErrorMessage(error, 'Unknown error')

        if (requestAbort.isRequestAborted() && !executionTimedOut) {
          reqLogger.info('Non-SSE execution aborted after client disconnect')
          return clientCancelledResponse()
        }
        if (
          isPayloadSizeLimitError(error) &&
          shouldRejectLargeInlineOutput &&
          error.label === 'Workflow execution response'
        ) {
          return payloadTooLargeResponse()
        }

        reqLogger.error(
          'Non-SSE execution failed',
          loggingSession.projectDiagnosticError(error, { isTimeout: executionTimedOut })
        )

        const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
        const status = executionTimedOut ? 408 : getExecutionErrorStatus(error)
        let compactErrorOutput: NormalizedBlockOutput | undefined
        if (executionResult && Object.hasOwn(executionResult, 'output')) {
          try {
            compactErrorOutput = await compactWorkflowResponseOutput(
              executionResult.output,
              workflowResponseCompaction
            )
          } catch (compactError) {
            if (
              isPayloadSizeLimitError(compactError) &&
              shouldRejectLargeInlineOutput &&
              compactError.label === 'Workflow execution response'
            ) {
              return payloadTooLargeResponse()
            }
            throw compactError
          }
        }
        return createExecutionJsonResponse(
          {
            success: false,
            output: compactErrorOutput,
            error: executionTimedOut
              ? errorMessage
              : executionResult?.error || errorMessage || 'Execution failed',
            metadata: executionResult?.metadata
              ? {
                  duration: executionResult.metadata.duration,
                  startTime: executionResult.metadata.startTime,
                  endTime: executionResult.metadata.endTime,
                }
              : undefined,
          },
          { status },
          includePrivateTraceProvenance,
          loggingSession
        )
      } finally {
        requestAbort.cleanup()
        timeoutController.cleanup()
        if (executionId) {
          void cleanupExecutionBase64Cache(executionId).catch((error) => {
            reqLogger.error('Failed to cleanup base64 cache', { error })
          })
        }
      }
    }

    if (shouldUseDraftState) {
      reqLogger.info('Using SSE console log streaming (manual execution)')
    } else {
      reqLogger.info('Using streaming API response')

      let resolvedSelectedOutputs: string[] | undefined
      try {
        resolvedSelectedOutputs = await resolveOutputIds(
          selectedOutputs,
          cachedWorkflowData?.blocks || {}
        )
      } catch (error) {
        await releaseExecutionSlot(executionId)
        return NextResponse.json(
          { error: `Invalid selectedOutputs: ${getErrorMessage(error)}` },
          { status: 400 }
        )
      }
      const streamVariables = cachedWorkflowData?.variables ?? (workflow as any).variables
      const streamWorkflow = {
        id: workflow.id,
        /**
         * The owner, not the actor: `executeWorkflow` reads this one field to set
         * `workflowUserId`, which is the personal-environment fallback for runs with
         * no identifiable caller. Passing the actor here made the streaming path
         * resolve the actor where the JSON path resolves the owner.
         */
        userId: workflow.userId,
        workspaceId,
        isDeployed: workflow.isDeployed,
        variables: streamVariables,
      }
      /**
       * The caller asked for frames whose shape is defined by a protocol
       * version they never declared. Rejecting beats silently downgrading:
       * the flags would otherwise be a no-op with no way to notice.
       */
      if (
        hasAgentStreamPolicy({
          includeThinking: requestedIncludeThinking,
          includeToolCalls: requestedIncludeToolCalls,
        }) &&
        !clientAcceptsAgentStreamProtocol(req.headers)
      ) {
        return NextResponse.json(
          {
            error: `includeThinking and includeToolCalls require the ${AGENT_STREAM_PROTOCOL_HEADER_LABEL}: ${AGENT_STREAM_PROTOCOL_V1} request header, which declares that the client understands agent-event frames.`,
          },
          { status: 400 }
        )
      }

      const agentEvents = shouldEmitAgentStreamEvents({
        includeThinking: requestedIncludeThinking,
        includeToolCalls: requestedIncludeToolCalls,
        requestHeaders: req.headers,
      })

      const stream = await createStreamingResponse({
        requestId,
        streamConfig: {
          selectedOutputs: resolvedSelectedOutputs,
          isSecureMode: false,
          workflowTriggerType: triggerType === 'chat' ? 'chat' : 'api',
          includeFileBase64,
          base64MaxBytes,
          timeoutMs: getEffectiveSyncTimeoutMs(),
          includeThinking: requestedIncludeThinking,
          includeToolCalls: requestedIncludeToolCalls,
        },
        executionId,
        largeValueExecutionIds,
        largeValueKeys,
        fileKeys,
        workspaceId,
        workflowId,
        userId: actorUserId,
        principal: executionPrincipal,
        allowLargeValueWorkflowScope,
        requestSignal: req.signal,
        requestHeaders: req.headers,
        executeFn: async ({ onStream, onBlockComplete, abortSignal }) =>
          executeWorkflow(
            streamWorkflow,
            requestId,
            processedInput,
            actorUserId,
            {
              enabled: true,
              selectedOutputs: resolvedSelectedOutputs,
              isSecureMode: false,
              workflowTriggerType: triggerType === 'chat' ? 'chat' : 'api',
              onStream,
              onBlockComplete: (blockId, data) =>
                onBlockComplete(blockId, data.output, data.outputBlockId),
              skipLoggingComplete: true,
              includeFileBase64,
              base64MaxBytes,
              abortSignal,
              executionMode: 'stream',
              principal: executionPrincipal,
              enforceCredentialAccess: useAuthenticatedUserAsActor,
              isPublicApiAccess,
              billingAttribution,
              largeValueKeys,
              fileKeys,
              stopAfterBlockId,
              runFromBlock: resolvedRunFromBlock,
              includeThinking: requestedIncludeThinking,
              includeToolCalls: requestedIncludeToolCalls,
              agentEvents,
              trustedInitialResolvedSecretTraceProvenance,
            },
            executionId
          ),
      })

      executionIdClaimCommitted = true
      return new NextResponse(stream, {
        status: 200,
        headers: {
          ...SSE_HEADERS,
          // Echo the negotiated stream protocol (same as the chat and resume routes).
          ...agentStreamProtocolResponseHeaders({ requestHeaders: req.headers }),
        },
      })
    }

    const encoder = new TextEncoder()
    const timeoutController = createTimeoutAbortController(getEffectiveSyncTimeoutMs())
    const didExecutionTimeOut = (error?: unknown) =>
      timeoutController.isTimedOut() ||
      hasInheritedDeadlineExpired() ||
      isTimeoutAbortReason(timeoutController.signal.reason) ||
      isTimeoutAbortReason(req.signal.reason) ||
      isTimeoutError(error)
    let isStreamClosed = false
    let isManualAbortRegistered = false
    const activeBlockStarts = new Map<string, { eventId: number; data: BlockStartedData }>()

    const eventWriter = createExecutionEventWriter(executionId, {
      workspaceId,
      workflowId,
      userId: actorUserId,
      preserveUserFileBase64: includeFileBase64,
    })
    const metaInitialized = await initializeExecutionStreamMeta(executionId, {
      userId: actorUserId,
      workflowId,
    })
    if (!metaInitialized) {
      timeoutController.cleanup()
      await releaseExecutionSlot(executionId)
      return NextResponse.json(
        { error: 'Run buffer temporarily unavailable' },
        { status: 503, headers: { [WORKFLOW_EXECUTION_ID_HEADER]: executionId } }
      )
    }

    executionIdClaimCommitted = true
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let finalMetaStatus: 'complete' | 'error' | 'cancelled' | null = null
        let postExecutionAwaited = false

        const awaitBoundCopilotPostExecution = async () => {
          if (!copilotToolCallId || postExecutionAwaited) return
          await loggingSession.waitForPostExecution()
          postExecutionAwaited = true
        }

        registerManualExecutionAborter(executionId, timeoutController.abort)
        isManualAbortRegistered = true

        let terminalEventPublished = false
        let sendFailure: unknown
        let sendQueue: Promise<void> = Promise.resolve()
        const sendEvent = (
          event: ExecutionEvent,
          terminalStatus?: TerminalExecutionStreamStatus
        ) => {
          const task = sendQueue.then(async () => {
            if (sendFailure) throw sendFailure
            const isBuffered = !LIVE_ONLY_EXECUTION_EVENT_TYPES.has(event.type)
            let eventToSend = event
            if (isBuffered) {
              const entry = terminalStatus
                ? await eventWriter.writeTerminal(event, terminalStatus)
                : await eventWriter.write(event)
              if (!terminalStatus) {
                await eventWriter.flush()
              }
              eventToSend = entry.event
              eventToSend.eventId = entry.eventId
              terminalEventPublished ||= Boolean(terminalStatus)

              if (eventToSend.type === 'block:started') {
                activeBlockStarts.set(getBlockInvocationKey(eventToSend.data), {
                  eventId: entry.eventId,
                  data: eventToSend.data,
                })
              } else if (
                eventToSend.type === 'block:completed' ||
                eventToSend.type === 'block:error'
              ) {
                activeBlockStarts.delete(getBlockInvocationKey(eventToSend.data))
              } else if (terminalStatus) {
                activeBlockStarts.clear()
              }

              if (
                eventToSend.type === 'block:started' ||
                eventToSend.type === 'block:completed' ||
                eventToSend.type === 'block:error'
              ) {
                const activeSnapshotPersisted = await setExecutionActiveBlockStarts(executionId, [
                  ...activeBlockStarts.values(),
                ])
                if (!activeSnapshotPersisted) {
                  throw new Error('Failed to persist active execution snapshot')
                }
              }
            }
            if (!isStreamClosed) {
              try {
                controller.enqueue(encodeSSEEvent(eventToSend))
              } catch {
                isStreamClosed = true
              }
            }
          })
          sendQueue = task.catch((error) => {
            sendFailure ??= error
            timeoutController.abort()
            if (!isStreamClosed) {
              try {
                controller.error(error)
              } catch {}
              isStreamClosed = true
            }
          })
          return task
        }

        try {
          const startTime = new Date()

          await sendEvent({
            type: 'execution:started',
            timestamp: startTime.toISOString(),
            executionId,
            workflowId,
            data: {
              startTime: startTime.toISOString(),
            },
          })

          const onBlockStart = async (
            blockId: string,
            blockName: string,
            blockType: string,
            executionOrder: number,
            iterationContext?: IterationContext,
            childWorkflowContext?: ChildWorkflowContext
          ) => {
            reqLogger.info('onBlockStart called', { blockId, blockName, blockType })
            await sendEvent({
              type: 'block:started',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: {
                blockId,
                blockName,
                blockType,
                executionOrder,
                ...(iterationContext && {
                  iterationCurrent: iterationContext.iterationCurrent,
                  iterationTotal: iterationContext.iterationTotal,
                  iterationType: iterationContext.iterationType,
                  iterationContainerId: iterationContext.iterationContainerId,
                  ...(iterationContext.parentIterations?.length && {
                    parentIterations: iterationContext.parentIterations,
                  }),
                }),
                ...(childWorkflowContext && {
                  childWorkflowBlockId: childWorkflowContext.parentBlockId,
                  childWorkflowName: childWorkflowContext.workflowName,
                }),
              },
            })
          }

          const onBlockComplete = async (
            blockId: string,
            blockName: string,
            blockType: string,
            callbackData: BlockCompletionCallbackData,
            iterationContext?: IterationContext,
            childWorkflowContext?: ChildWorkflowContext
          ) => {
            const compactCallbackData = {
              ...callbackData,
              input: await compactRoutePayload(callbackData.input, {
                workspaceId,
                workflowId,
                executionId,
                userId: actorUserId,
                preserveUserFileBase64: includeFileBase64,
                preserveRoot: true,
              }),
              output: await compactRoutePayload(callbackData.output, {
                workspaceId,
                workflowId,
                executionId,
                userId: actorUserId,
                preserveUserFileBase64: includeFileBase64,
                preserveRoot: true,
              }),
            }
            const callbackError = compactCallbackData.output?.error
            const hasError = typeof callbackError === 'string' && callbackError.length > 0
            const display = await loggingSession.projectDisplayContent(
              {
                input: compactCallbackData.input,
                output: compactCallbackData.output,
                ...(hasError ? { error: callbackError } : {}),
              },
              callbackData.displayResolvedSecretTraceProvenance
            )
            const childWorkflowData = childWorkflowContext
              ? {
                  childWorkflowBlockId: childWorkflowContext.parentBlockId,
                  childWorkflowName: childWorkflowContext.workflowName,
                }
              : {}

            const instanceData = callbackData.childWorkflowInstanceId
              ? { childWorkflowInstanceId: callbackData.childWorkflowInstanceId }
              : {}

            if (hasError) {
              reqLogger.info('onBlockComplete (error) called', {
                blockId,
                blockName,
                blockType,
                error: display.error,
              })
              await sendEvent({
                type: 'block:error',
                timestamp: new Date().toISOString(),
                executionId,
                workflowId,
                data: {
                  blockId,
                  blockName,
                  blockType,
                  input: compactCallbackData.input,
                  error: callbackError,
                  display: {
                    ...(Object.hasOwn(display, 'input') ? { input: display.input } : {}),
                    ...(display.error !== undefined ? { error: display.error } : {}),
                    ...(display.clearLiveDisplay ? { clearLiveDisplay: true as const } : {}),
                  },
                  durationMs: compactCallbackData.executionTime || 0,
                  startedAt: compactCallbackData.startedAt,
                  executionOrder: compactCallbackData.executionOrder,
                  endedAt: compactCallbackData.endedAt,
                  ...(iterationContext && {
                    iterationCurrent: iterationContext.iterationCurrent,
                    iterationTotal: iterationContext.iterationTotal,
                    iterationType: iterationContext.iterationType,
                    iterationContainerId: iterationContext.iterationContainerId,
                    ...(iterationContext.parentIterations?.length && {
                      parentIterations: iterationContext.parentIterations,
                    }),
                  }),
                  ...childWorkflowData,
                  ...instanceData,
                },
              })
            } else {
              reqLogger.info('onBlockComplete called', {
                blockId,
                blockName,
                blockType,
              })
              await sendEvent({
                type: 'block:completed',
                timestamp: new Date().toISOString(),
                executionId,
                workflowId,
                data: {
                  blockId,
                  blockName,
                  blockType,
                  input: compactCallbackData.input,
                  output: compactCallbackData.output,
                  display: {
                    ...(Object.hasOwn(display, 'input') ? { input: display.input } : {}),
                    ...(Object.hasOwn(display, 'output') ? { output: display.output } : {}),
                    ...(display.clearLiveDisplay ? { clearLiveDisplay: true as const } : {}),
                  },
                  durationMs: compactCallbackData.executionTime || 0,
                  startedAt: compactCallbackData.startedAt,
                  executionOrder: compactCallbackData.executionOrder,
                  endedAt: compactCallbackData.endedAt,
                  ...(iterationContext && {
                    iterationCurrent: iterationContext.iterationCurrent,
                    iterationTotal: iterationContext.iterationTotal,
                    iterationType: iterationContext.iterationType,
                    iterationContainerId: iterationContext.iterationContainerId,
                    ...(iterationContext.parentIterations?.length && {
                      parentIterations: iterationContext.parentIterations,
                    }),
                  }),
                  ...childWorkflowData,
                  ...instanceData,
                },
              })
            }
          }

          const onStream = async (streamingExec: StreamingExecution) => {
            const blockId = (streamingExec.execution as any).blockId

            // Live answer text rides the sink when available (pending deltas
            // stream as the model generates; chunk_reset clears intermediate
            // turns). The byte stream is then drained without re-emitting
            // chunks — its text is the same final-turn content.
            const answerTextFromSink = shouldForwardAnswerTextFromSink(streamingExec)

            // Sync window: attach sink before first await so pump delivers thinking/tools.
            const unsubscribe = forwardAgentStreamToExecutionEvents(streamingExec, {
              blockId,
              executionId,
              workflowId,
              sendEvent,
              forwardAnswerText: answerTextFromSink,
              projectDisplay: (field, value) =>
                loggingSession.projectLiveDisplayText(
                  field,
                  value,
                  streamingExec.displayResolvedSecretTraceProvenance
                ),
            })

            const reader = streamingExec.stream.getReader()
            const decoder = new TextDecoder()
            const cancelReader = () => {
              void reader.cancel(timeoutController.signal.reason).catch(() => {})
            }

            try {
              if (timeoutController.signal.aborted) return
              timeoutController.signal.addEventListener('abort', cancelReader, { once: true })

              while (true) {
                if (timeoutController.signal.aborted) break
                const { done, value } = await reader.read()
                if (timeoutController.signal.aborted) break
                if (done) break

                if (answerTextFromSink) continue

                const chunk = decoder.decode(value, { stream: true })
                const display = await loggingSession.projectLiveDisplayText(
                  'chunk',
                  chunk,
                  streamingExec.displayResolvedSecretTraceProvenance
                )
                await sendEvent({
                  type: 'stream:chunk',
                  timestamp: new Date().toISOString(),
                  executionId,
                  workflowId,
                  data: { blockId, chunk, display },
                })
              }

              if (!timeoutController.signal.aborted) {
                await sendEvent({
                  type: 'stream:done',
                  timestamp: new Date().toISOString(),
                  executionId,
                  workflowId,
                  data: { blockId },
                })
              }
            } catch (error) {
              if (!timeoutController.signal.aborted) {
                reqLogger.error(
                  'Error streaming block content',
                  loggingSession.projectDiagnosticError(error, { blockId })
                )
              }
            } finally {
              unsubscribe()
              timeoutController.signal.removeEventListener('abort', cancelReader)
              try {
                await reader.cancel().catch(() => {})
              } catch {}
            }
          }

          const metadata: ExecutionMetadata = {
            requestId,
            executionId,
            workflowId,
            workspaceId,
            userId: actorUserId,
            principal: executionPrincipal,
            billingAttribution,
            sessionUserId: isClientSession ? userId : undefined,
            workflowUserId: workflow.userId,
            triggerType,
            triggerBlockId,
            useDraftState: shouldUseDraftState,
            startTime: new Date().toISOString(),
            isClientSession,
            enforceCredentialAccess: useAuthenticatedUserAsActor,
            isPublicApiAccess,
            workflowStateOverride: effectiveWorkflowStateOverride,
            largeValueExecutionIds,
            largeValueKeys,
            fileKeys,
            allowLargeValueWorkflowScope,
            callChain,
            executionMode: 'sync',
            // Canvas execution-events runs are the primary agent-events surface.
            agentEvents: true,
          }

          const sseExecutionVariables = cachedWorkflowData?.variables ?? workflow.variables ?? {}

          const snapshot = new ExecutionSnapshot(
            metadata,
            workflow,
            processedInput,
            sseExecutionVariables,
            selectedOutputs
          )

          const onChildWorkflowInstanceReady = async (
            blockId: string,
            childWorkflowInstanceId: string,
            iterationContext?: IterationContext,
            executionOrder?: number,
            childWorkflowContext?: ChildWorkflowContext
          ) => {
            await sendEvent({
              type: 'block:childWorkflowStarted',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: {
                blockId,
                childWorkflowInstanceId,
                ...(iterationContext && {
                  iterationCurrent: iterationContext.iterationCurrent,
                  iterationTotal: iterationContext.iterationTotal,
                  iterationType: iterationContext.iterationType,
                  iterationContainerId: iterationContext.iterationContainerId,
                  ...(iterationContext.parentIterations?.length && {
                    parentIterations: iterationContext.parentIterations,
                  }),
                }),
                ...(childWorkflowContext && {
                  childWorkflowBlockId: childWorkflowContext.parentBlockId,
                  childWorkflowName: childWorkflowContext.workflowName,
                }),
                ...(executionOrder !== undefined && { executionOrder }),
              },
            })
          }

          const result = await executeWorkflowCore({
            snapshot,
            callbacks: {
              onBlockStart,
              onBlockComplete,
              onStream,
              onChildWorkflowInstanceReady,
            },
            loggingSession,
            abortSignal: timeoutController.signal,
            includeFileBase64,
            base64MaxBytes,
            stopAfterBlockId,
            runFromBlock: resolvedRunFromBlock,
            trustedInitialResolvedSecretTraceProvenance,
          })

          await awaitBoundCopilotPostExecution()

          await handlePostExecutionPauseState({ result, workflowId, executionId, loggingSession })

          /**
           * Compact block logs once and reuse across cancelled/timeout/paused/complete
           * SSE events. Walks all block logs and durably serializes large values to
           * object storage, so doing it twice would double the latency and storage
           * load on the happy path.
           */
          const displayBlockLogs = await loggingSession.projectBlockLogsForDisplay(
            result.logs ?? []
          )
          const compactedBlockLogs = await compactBlockLogs(displayBlockLogs, {
            workspaceId,
            workflowId,
            executionId,
            userId: actorUserId,
            requireDurable: true,
          })

          if (result.status === 'cancelled') {
            if (didExecutionTimeOut() && timeoutController.timeoutMs) {
              const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
              reqLogger.info('Workflow execution timed out', {
                timeoutMs: timeoutController.timeoutMs,
              })

              await loggingSession.markAsFailed(timeoutErrorMessage)
              const timeoutDisplay = await loggingSession.projectDisplayContent({
                error: timeoutErrorMessage,
              })

              finalMetaStatus = 'error'
              await sendEvent(
                {
                  type: 'execution:error',
                  timestamp: new Date().toISOString(),
                  executionId,
                  workflowId,
                  data: {
                    error: timeoutErrorMessage,
                    display: {
                      ...(timeoutDisplay.error !== undefined
                        ? { error: timeoutDisplay.error }
                        : {}),
                    },
                    duration: result.metadata?.duration || 0,
                    finalBlockLogs: compactedBlockLogs,
                  },
                },
                'error'
              )
            } else {
              reqLogger.info('Workflow execution was cancelled')

              finalMetaStatus = 'cancelled'
              await sendEvent(
                {
                  type: 'execution:cancelled',
                  timestamp: new Date().toISOString(),
                  executionId,
                  workflowId,
                  data: {
                    duration: result.metadata?.duration || 0,
                    finalBlockLogs: compactedBlockLogs,
                  },
                },
                'cancelled'
              )
            }
            return
          }

          const outputLargeValueKeys = result.metadata?.largeValueKeys ?? largeValueKeys
          const outputFileKeys = result.metadata?.fileKeys ?? fileKeys

          const sseOutput = includeFileBase64
            ? await hydrateUserFilesWithBase64(result.output, {
                requestId,
                workspaceId,
                workflowId,
                executionId,
                largeValueExecutionIds,
                largeValueKeys: outputLargeValueKeys,
                fileKeys: outputFileKeys,
                allowLargeValueWorkflowScope,
                userId: actorUserId,
                principal: executionPrincipal,
                maxBytes: base64MaxBytes,
                preserveLargeValueMetadata: true,
              })
            : result.output
          const compactSseOutput = await compactRoutePayload(sseOutput, {
            workspaceId,
            workflowId,
            executionId,
            userId: actorUserId,
            preserveUserFileBase64: true,
            preserveRoot: true,
          })

          if (result.status === 'paused') {
            finalMetaStatus = 'complete'
            await sendEvent(
              {
                type: 'execution:paused',
                timestamp: new Date().toISOString(),
                executionId,
                workflowId,
                data: {
                  output: compactSseOutput,
                  duration: result.metadata?.duration || 0,
                  startTime: result.metadata?.startTime || startTime.toISOString(),
                  endTime: result.metadata?.endTime || new Date().toISOString(),
                  finalBlockLogs: compactedBlockLogs,
                },
              },
              'complete'
            )
          } else {
            finalMetaStatus = 'complete'
            await sendEvent(
              {
                type: 'execution:completed',
                timestamp: new Date().toISOString(),
                executionId,
                workflowId,
                data: {
                  success: result.success,
                  output: compactSseOutput,
                  duration: result.metadata?.duration || 0,
                  startTime: result.metadata?.startTime || startTime.toISOString(),
                  endTime: result.metadata?.endTime || new Date().toISOString(),
                  finalBlockLogs: compactedBlockLogs,
                },
              },
              'complete'
            )
          }
        } catch (error: unknown) {
          await awaitBoundCopilotPostExecution()
          const isTimeout = didExecutionTimeOut(error)
          const errorMessage = isTimeout
            ? getTimeoutErrorMessage(error, timeoutController.timeoutMs)
            : getErrorMessage(error, 'Unknown error')

          reqLogger.error(
            'SSE execution failed',
            loggingSession.projectDiagnosticError(error, { isTimeout })
          )

          const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
          let compactErrorLogs: BlockLog[] | undefined
          try {
            compactErrorLogs = executionResult?.logs
              ? await compactBlockLogs(
                  await loggingSession.projectBlockLogsForDisplay(executionResult.logs),
                  {
                    workspaceId,
                    workflowId,
                    executionId,
                    userId: actorUserId,
                    requireDurable: true,
                  }
                )
              : undefined
          } catch (compactionError) {
            reqLogger.warn(
              'Failed to compact SSE error logs, omitting oversized error details',
              loggingSession.projectDiagnosticError(compactionError)
            )
          }

          finalMetaStatus = 'error'
          const terminalError = executionResult?.error || errorMessage
          const terminalDisplay = await loggingSession.projectDisplayContent({
            error: terminalError,
          })
          await sendEvent(
            {
              type: 'execution:error',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: {
                error: terminalError,
                display: {
                  ...(terminalDisplay.error !== undefined ? { error: terminalDisplay.error } : {}),
                },
                duration: executionResult?.metadata?.duration || 0,
                finalBlockLogs: compactErrorLogs,
              },
            },
            'error'
          )
        } finally {
          if (isManualAbortRegistered) {
            unregisterManualExecutionAborter(executionId)
            isManualAbortRegistered = false
          }
          if (finalMetaStatus && !terminalEventPublished) {
            const replayBufferFlushed = await flushExecutionStreamReplayBuffer(
              executionId,
              eventWriter
            )
            const terminalMetaPersisted = await markExecutionStreamTerminal(
              executionId,
              finalMetaStatus
            )
            reqLogger.error('Failed to publish terminal execution event durably', {
              executionId,
              status: finalMetaStatus,
              replayBufferFlushed,
              terminalMetaPersisted,
            })
            if (!isStreamClosed) {
              controller.error(new Error('Run buffer terminal event publish failed'))
              isStreamClosed = true
            }
          } else if (terminalEventPublished) {
            await eventWriter.close().catch((closeError) => {
              reqLogger.warn(
                'Failed to close execution event writer after terminal publish',
                loggingSession.projectDiagnosticError(closeError, { executionId })
              )
            })
          } else {
            try {
              await eventWriter.close()
            } catch (closeError) {
              reqLogger.warn(
                'Failed to close event writer',
                loggingSession.projectDiagnosticError(closeError, { executionId })
              )
            }
          }
          timeoutController.cleanup()
          if (executionId) {
            await cleanupExecutionBase64Cache(executionId)
          }
          if (!isStreamClosed) {
            try {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
            } catch {}
          }
        }
      },
      cancel() {
        isStreamClosed = true
        reqLogger.info('Client detached from SSE stream; workflow execution remains active')
      },
    })

    return new NextResponse(stream, {
      headers: {
        ...SSE_HEADERS,
        [WORKFLOW_EXECUTION_ID_HEADER]: executionId,
      },
    })
  } catch (error: any) {
    reqLogger.error('Failed to start workflow execution:', error)
    // Release a reserved billing slot if a throw exited before the stream took
    // over its release (idempotent; no-op when never reserved).
    if (executionId) await releaseExecutionSlot(executionId)
    return NextResponse.json(
      { error: error.message || 'Failed to start workflow execution' },
      { status: 500 }
    )
  } finally {
    if (executionIdClaim && !executionIdClaimCommitted) {
      try {
        executionIdClaimCommitted = await hasDurableExecutionOwner(executionId)
      } catch (error) {
        executionIdClaimCommitted = true
        reqLogger.warn('Unable to verify execution ID ownership; retaining claim', {
          error: toError(error).message,
          executionId,
        })
      }
    }

    if (copilotToolCallId && workflowToolClaimAcquired && !executionIdClaimCommitted) {
      try {
        await releaseWorkflowToolExecutionClaim(copilotToolCallId, executionId)
      } catch (error) {
        reqLogger.warn('Failed to release pre-start Copilot workflow tool claim', {
          error: toError(error).message,
          executionId,
          copilotToolCallId,
        })
      }
    }

    if (executionIdClaim && !executionIdClaimCommitted) {
      try {
        await releaseExecutionIdClaim(executionIdClaim)
      } catch (error) {
        reqLogger.warn('Failed to release pre-start execution ID claim', {
          error: toError(error).message,
          executionId,
        })
      }
    }
  }
}
