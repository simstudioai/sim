import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId, isValidUuid } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  executeWorkflowBodySchema,
  executeWorkflowHeadersSchema,
  executionIdSchema,
  WORKFLOW_EXECUTION_ID_HEADER,
} from '@/lib/api/contracts/workflows'
import { AuthType, checkHybridAuth, hasExternalApiCredentials } from '@/lib/auth/hybrid'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  requireBillingAttributionHeader,
} from '@/lib/billing/core/billing-attribution'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { getJobQueue, shouldExecuteInline } from '@/lib/core/async-jobs'
import { isAsyncJobEnqueueError } from '@/lib/core/async-jobs/types'
import {
  createTimeoutAbortController,
  getTimeoutErrorMessage,
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
  type TerminalExecutionStreamStatus,
} from '@/lib/execution/event-buffer'
import { processInputFileFields } from '@/lib/execution/files'
import {
  registerManualExecutionAborter,
  unregisterManualExecutionAborter,
} from '@/lib/execution/manual-cancellation'
import { containsLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { compactBlockLogs, compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import { type PreprocessExecutionSuccess, preprocessExecution } from '@/lib/execution/preprocessing'
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
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import {
  type ExecutionEvent,
  encodeSSEEvent,
  LIVE_ONLY_EXECUTION_EVENT_TYPES,
} from '@/lib/workflows/executor/execution-events'
import {
  claimExecutionId,
  type ExecutionIdClaim,
  hasDurableExecutionOwner,
  releaseExecutionIdClaim,
} from '@/lib/workflows/executor/execution-id-claim'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import {
  loadDeployedWorkflowState,
  loadWorkflowDeploymentVersionState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { forwardAgentStreamToExecutionEvents } from '@/lib/workflows/streaming/forward-agent-stream-events'
import { createStreamingResponse } from '@/lib/workflows/streaming/streaming'
import { createHttpResponseFromBlock, workflowHasResponseBlock } from '@/lib/workflows/utils'
import { getWorkspaceBillingSettings } from '@/lib/workspaces/utils'
import { executeWorkflowJob, type WorkflowExecutionPayload } from '@/background/workflow-execution'
import { withCustomBlockOverlay } from '@/blocks/custom/server-overlay'
import {
  PublicApiNotAllowedError,
  validatePublicApiAllowed,
} from '@/ee/access-control/utils/permission-check'
import { normalizeName } from '@/executor/constants'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type {
  ChildWorkflowContext,
  ExecutionMetadata,
  IterationContext,
  SerializableExecutionState,
} from '@/executor/execution/types'
import type { BlockLog, NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import { getExecutionErrorStatus, hasExecutionResult } from '@/executor/utils/errors'
import { Serializer } from '@/serializer'
import { CORE_TRIGGER_TYPES, type CoreTriggerType } from '@/stores/logs/filters/types'

const logger = createLogger('WorkflowExecuteAPI')
const MAX_WORKFLOW_EXECUTE_BODY_BYTES = 10 * 1024 * 1024
const SERVER_EXECUTION_ID_CLAIM_ATTEMPTS = 3
const ASYNC_ENQUEUE_ATTEMPTS = 2
const WORKFLOW_EXECUTION_JOB_ID_PREFIX = 'workflow-execution:'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

function payloadTooLargeResponse(message = 'Workflow execution response exceeds maximum size') {
  return NextResponse.json(
    { success: false, error: message, code: 'workflow_response_too_large' },
    { status: 413 }
  )
}

function resolveOutputIds(
  selectedOutputs: string[] | undefined,
  blocks: Record<string, any>
): string[] | undefined {
  if (!selectedOutputs || selectedOutputs.length === 0) {
    return selectedOutputs
  }

  return selectedOutputs.map((outputId) => {
    const underscoreIndex = outputId.indexOf('_')
    const dotIndex = outputId.indexOf('.')
    if (underscoreIndex > 0) {
      const maybeUuid = outputId.substring(0, underscoreIndex)
      if (isValidUuid(maybeUuid)) {
        return outputId
      }
    }

    if (dotIndex > 0) {
      const maybeUuid = outputId.substring(0, dotIndex)
      if (isValidUuid(maybeUuid)) {
        return `${outputId.substring(0, dotIndex)}_${outputId.substring(dotIndex + 1)}`
      }
    }

    if (isValidUuid(outputId)) {
      return outputId
    }

    if (dotIndex === -1) {
      logger.warn(`Invalid output ID format (missing dot): ${outputId}`)
      return outputId
    }

    const blockName = outputId.substring(0, dotIndex)
    const path = outputId.substring(dotIndex + 1)

    const normalizedBlockName = normalizeName(blockName)
    const block = Object.values(blocks).find((b: any) => {
      return normalizeName(b.name || '') === normalizedBlockName
    })

    if (!block) {
      logger.warn(`Block not found for name: ${blockName} (from output ID: ${outputId})`)
      return outputId
    }

    const resolvedId = `${block.id}_${path}`
    logger.debug(`Resolved output ID: ${outputId} -> ${resolvedId}`)
    return resolvedId
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
  userId: string
  billingAttribution: BillingAttributionSnapshot
  workspaceId: string
  input: any
  triggerType: CoreTriggerType
  executionId: string
  callChain?: string[]
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
  const {
    requestId,
    workflowId,
    userId,
    billingAttribution,
    workspaceId,
    input,
    triggerType,
    executionId,
    callChain,
  } = params
  const asyncLogger = logger.withMetadata({
    requestId,
    workflowId,
    workspaceId,
    userId,
    executionId,
  })

  const correlation = {
    executionId,
    requestId,
    source: 'workflow' as const,
    workflowId,
    triggerType,
  }

  const payload: WorkflowExecutionPayload = {
    workflowId,
    userId,
    billingAttribution,
    workspaceId,
    input,
    triggerType,
    executionId,
    requestId,
    correlation,
    callChain,
    executionMode: 'async',
    admissionCompleted: true,
  }

  let jobQueue: Awaited<ReturnType<typeof getJobQueue>>
  try {
    jobQueue = await getJobQueue()
  } catch (error) {
    asyncLogger.error('Failed to initialize async execution queue', {
      error: toError(error).message,
    })
    await releaseExecutionSlot(executionId)
    return {
      response: NextResponse.json({ error: 'Failed to queue async execution' }, { status: 500 }),
      retainExecutionClaim: false,
    }
  }

  const deterministicJobId = `${WORKFLOW_EXECUTION_JOB_ID_PREFIX}${executionId}`
  const enqueueOptions = {
    jobId: deterministicJobId,
    metadata: { workflowId, workspaceId, userId, correlation },
  }
  let jobId: string | undefined
  let enqueueError: unknown
  let acceptanceCouldBeUnknown = false

  for (let attempt = 1; attempt <= ASYNC_ENQUEUE_ATTEMPTS; attempt++) {
    try {
      jobId = await jobQueue.enqueue('workflow-execution', payload, enqueueOptions)
      enqueueError = undefined
      break
    } catch (error) {
      enqueueError = error
      const classifiedError = isAsyncJobEnqueueError(error) ? error : undefined
      const attemptAcceptance = classifiedError?.acceptance ?? 'unknown'
      acceptanceCouldBeUnknown ||= attemptAcceptance === 'unknown'
      asyncLogger.warn('Async workflow enqueue attempt failed', {
        acceptance: attemptAcceptance,
        attempt,
        error: toError(error).message,
        jobId: deterministicJobId,
      })
      if (classifiedError?.retryable === false || attempt === ASYNC_ENQUEUE_ATTEMPTS) {
        break
      }
    }
  }

  if (!jobId) {
    const acceptance = acceptanceCouldBeUnknown
      ? 'unknown'
      : isAsyncJobEnqueueError(enqueueError)
        ? enqueueError.acceptance
        : 'unknown'
    asyncLogger.error('Failed to queue async execution', {
      acceptance,
      error: toError(enqueueError).message,
      jobId: deterministicJobId,
    })

    if (acceptance === 'rejected') {
      await releaseExecutionSlot(executionId)
      return {
        response: NextResponse.json({ error: 'Failed to queue async execution' }, { status: 500 }),
        retainExecutionClaim: false,
      }
    }

    return {
      response: NextResponse.json(
        {
          error: 'Async execution queue acceptance could not be confirmed',
          code: 'ASYNC_ENQUEUE_AMBIGUOUS',
          executionId,
        },
        { status: 503, headers: { [WORKFLOW_EXECUTION_ID_HEADER]: executionId } }
      ),
      retainExecutionClaim: true,
    }
  }

  asyncLogger.info('Queued async workflow execution', { jobId })

  if (shouldExecuteInline()) {
    void (async () => {
      let workerOwnsReservation = false
      try {
        await jobQueue.startJob(jobId)
        workerOwnsReservation = true
        const output = await executeWorkflowJob(payload)
        await jobQueue.completeJob(jobId, output)
      } catch (error) {
        const errorMessage = toError(error).message
        asyncLogger.error('Async workflow execution failed', {
          jobId,
          error: errorMessage,
        })
        /**
         * Before worker ownership transfers, no LoggingSession exists to
         * release the route's reservation.
         */
        if (!workerOwnsReservation) {
          await releaseExecutionSlot(executionId)
        }
        try {
          await jobQueue.markJobFailed(jobId, errorMessage)
        } catch (markFailedError) {
          asyncLogger.error('Failed to mark job as failed', {
            jobId,
            error: toError(markFailedError).message,
          })
        }
      }
    })()
  }

  return {
    response: NextResponse.json(
      {
        success: true,
        async: true,
        jobId,
        executionId,
        message: 'Workflow execution queued',
        statusUrl: `${getBaseUrl()}/api/jobs/${jobId}`,
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

    const isMcpBridgeRequest =
      auth.authType === AuthType.INTERNAL_JWT && req.headers.get(MCP_TOOL_BRIDGE_HEADER) === 'true'
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
          userId: workflowTable.userId,
          workspaceId: workflowTable.workspaceId,
        })
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)

      if (!wf?.isPublicApi || !wf.isDeployed || !wf.workspaceId) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
      }

      try {
        await validatePublicApiAllowed(wf.userId, wf.workspaceId)
      } catch (err) {
        if (err instanceof PublicApiNotAllowedError) {
          return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
        }
        throw err
      }

      userId = wf.userId
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
        return clientCancelledResponse()
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
    })
    if (!headerValidation.success) {
      reqLogger.warn('Invalid execution ID header', {
        issues: headerValidation.error.issues,
      })
      return NextResponse.json(
        {
          error: 'Invalid execution ID header',
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
      useDraftState,
      input: validatedInput,
      isClientSession = false,
      includeFileBase64,
      base64MaxBytes,
      workflowStateOverride,
      deploymentVersionId: admittedDeploymentVersionId,
      executionId: rawBodyExecutionId,
      triggerBlockId: parsedTriggerBlockId,
      startBlockId,
      stopAfterBlockId,
      runFromBlock: rawRunFromBlock,
      parentWorkspaceId,
    } = validation.data
    const triggerBlockId = parsedTriggerBlockId ?? startBlockId
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

      if (rawRunFromBlock.sourceSnapshot && !isPublicApiAccess) {
        // Public API callers cannot inject arbitrary block state via sourceSnapshot.
        // They must use executionId to resume from a server-stored execution state.
        resolvedRunFromBlock = {
          startBlockId: rawRunFromBlock.startBlockId,
          sourceSnapshot: rawRunFromBlock.sourceSnapshot as SerializableExecutionState,
        }
      } else if (rawRunFromBlock.executionId) {
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
          return NextResponse.json(
            {
              error: `No execution state found for ${rawRunFromBlock.executionId === 'latest' ? 'workflow' : `execution ${rawRunFromBlock.executionId}`}. Run the full workflow first.`,
            },
            { status: 400 }
          )
        }
        resolvedRunFromBlock = {
          startBlockId: rawRunFromBlock.startBlockId,
          sourceSnapshot: snapshot,
          sourceExecutionId: sourceExecution.executionId,
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
    const input = isMcpBridgeRequest
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
              includeFileBase64,
              base64MaxBytes,
              workflowStateOverride,
              deploymentVersionId: _deploymentVersionId,
              triggerBlockId: _triggerBlockId,
              stopAfterBlockId: _stopAfterBlockId,
              runFromBlock: _runFromBlock,
              workflowId: _workflowId, // Also exclude workflowId used for internal JWT auth
              parentWorkspaceId: _parentWorkspaceId,
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
      : (useDraftState ?? auth.authType === AuthType.SESSION)
    const streamHeader = req.headers.get('X-Stream-Response') === 'true'
    const enableSSE = streamHeader || streamParam === true
    const executionModeHeader = req.headers.get('X-Execution-Mode')
    const isAsyncMode = executionModeHeader === 'async'
    const requiresWriteExecutionAccess = Boolean(
      useDraftState || workflowStateOverride || rawRunFromBlock
    )

    if (req.signal.aborted) {
      return clientCancelledResponse()
    }

    if (
      isAsyncMode &&
      (body.useDraftState !== undefined ||
        body.workflowStateOverride !== undefined ||
        body.runFromBlock !== undefined ||
        body.triggerBlockId !== undefined ||
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
    if (auth.authType === AuthType.API_KEY) {
      if (auth.apiKeyType === 'workspace' && auth.workspaceId !== workflowWorkspaceId) {
        return NextResponse.json(
          { error: 'API key is not authorized for this workspace' },
          { status: 403 }
        )
      }

      if (auth.apiKeyType === 'personal') {
        const workspaceSettings = workflowWorkspaceId
          ? await getWorkspaceBillingSettings(workflowWorkspaceId)
          : null
        if (!workspaceSettings?.allowPersonalApiKeys) {
          return NextResponse.json(
            { error: 'Personal API keys are not allowed for this workspace' },
            { status: 403 }
          )
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

    const upstreamBillingAttribution =
      auth.authType === AuthType.INTERNAL_JWT && workflowAuthorization.workflow?.workspaceId
        ? requireBillingAttributionHeader(req.headers, {
            actorUserId: userId,
            workspaceId: workflowAuthorization.workflow.workspaceId,
          })
        : undefined

    if (req.signal.aborted) {
      return clientCancelledResponse()
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

    const loggingSession = new LoggingSession(
      workflowId,
      executionId,
      loggingTriggerType,
      requestId
    )

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
    })

    if (!preprocessResult.success) {
      const preprocessError = preprocessResult.error
      return NextResponse.json(
        { error: preprocessError.message },
        { status: preprocessError.statusCode }
      )
    }

    // Preprocessing reserved an admission slot (released when the LoggingSession
    // finalizes). Any path that exits before execution starts must release it
    // here, or the slot leaks until its TTL and wrongly throttles later runs.
    if (req.signal.aborted) {
      await releaseExecutionSlot(executionId)
      return clientCancelledResponse()
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

    if (isAsyncMode) {
      const asyncResult = await handleAsyncExecution({
        requestId,
        workflowId,
        userId: actorUserId,
        billingAttribution,
        workspaceId,
        input,
        triggerType: loggingTriggerType,
        executionId,
        callChain,
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
        return clientCancelledResponse()
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
        return clientCancelledResponse()
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
        billingAttribution,
        sessionUserId: isClientSession ? userId : undefined,
        workflowUserId: workflow.userId,
        triggerType,
        triggerBlockId,
        useDraftState: shouldUseDraftState,
        startTime: new Date().toISOString(),
        isClientSession,
        enforceCredentialAccess: useAuthenticatedUserAsActor,
        workflowStateOverride: effectiveWorkflowStateOverride,
        largeValueExecutionIds,
        largeValueKeys,
        fileKeys,
        allowLargeValueWorkflowScope,
        callChain,
        executionMode: 'sync',
      }

      const executionVariables = cachedWorkflowData?.variables ?? workflow.variables ?? {}

      const timeoutController = createTimeoutAbortController(
        preprocessResult.executionTimeout?.sync
      )
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
        })

        await handlePostExecutionPauseState({ result, workflowId, executionId, loggingSession })

        if (
          result.status === 'cancelled' &&
          requestAbort.isRequestAborted() &&
          !timeoutController.isTimedOut()
        ) {
          reqLogger.info('Non-SSE execution cancelled by client disconnect')
          await loggingSession.markAsFailed('Client cancelled request')
          return clientCancelledResponse()
        }

        if (
          result.status === 'cancelled' &&
          timeoutController.isTimedOut() &&
          timeoutController.timeoutMs
        ) {
          const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
          reqLogger.info('Non-SSE execution timed out', {
            timeoutMs: timeoutController.timeoutMs,
          })
          await loggingSession.markAsFailed(timeoutErrorMessage)
          const compactResultOutput = await compactWorkflowResponseOutput(
            result.output,
            workflowResponseCompaction
          )

          return NextResponse.json(
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
            { status: 408 }
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

        return NextResponse.json(filteredResult)
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error, 'Unknown error')

        if (requestAbort.isRequestAborted() && !timeoutController.isTimedOut()) {
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

        reqLogger.error(`Non-SSE execution failed: ${errorMessage}`)

        const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
        const status = getExecutionErrorStatus(error)
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
        return NextResponse.json(
          {
            success: false,
            output: compactErrorOutput,
            error: executionResult?.error || errorMessage || 'Execution failed',
            metadata: executionResult?.metadata
              ? {
                  duration: executionResult.metadata.duration,
                  startTime: executionResult.metadata.startTime,
                  endTime: executionResult.metadata.endTime,
                }
              : undefined,
          },
          { status }
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

      const resolvedSelectedOutputs = resolveOutputIds(
        selectedOutputs,
        cachedWorkflowData?.blocks || {}
      )
      const streamVariables = cachedWorkflowData?.variables ?? (workflow as any).variables
      const streamWorkflow = {
        id: workflow.id,
        userId: actorUserId,
        workspaceId,
        isDeployed: workflow.isDeployed,
        variables: streamVariables,
      }
      const stream = await createStreamingResponse({
        requestId,
        streamConfig: {
          selectedOutputs: resolvedSelectedOutputs,
          isSecureMode: false,
          workflowTriggerType: triggerType === 'chat' ? 'chat' : 'api',
          includeFileBase64,
          base64MaxBytes,
          timeoutMs: preprocessResult.executionTimeout?.sync,
          // Workflow API has no chat includeThinking policy — thinking frames stay off.
          includeThinking: false,
        },
        executionId,
        largeValueExecutionIds,
        largeValueKeys,
        fileKeys,
        workspaceId,
        workflowId,
        userId: actorUserId,
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
              onBlockComplete,
              skipLoggingComplete: true,
              includeFileBase64,
              base64MaxBytes,
              abortSignal,
              executionMode: 'stream',
              billingAttribution,
              largeValueKeys,
              fileKeys,
              stopAfterBlockId,
              runFromBlock: resolvedRunFromBlock,
            },
            executionId
          ),
      })

      executionIdClaimCommitted = true
      return new NextResponse(stream, {
        status: 200,
        headers: SSE_HEADERS,
      })
    }

    const encoder = new TextEncoder()
    const timeoutController = createTimeoutAbortController(preprocessResult.executionTimeout?.sync)
    let isStreamClosed = false
    let isManualAbortRegistered = false

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

        registerManualExecutionAborter(executionId, timeoutController.abort)
        isManualAbortRegistered = true

        let terminalEventPublished = false
        const sendEvent = async (
          event: ExecutionEvent,
          terminalStatus?: TerminalExecutionStreamStatus
        ) => {
          const isBuffered = !LIVE_ONLY_EXECUTION_EVENT_TYPES.has(event.type)
          let eventToSend = event
          if (isBuffered) {
            try {
              const entry = terminalStatus
                ? await eventWriter.writeTerminal(event, terminalStatus)
                : await eventWriter.write(event)
              eventToSend = entry.event
              eventToSend.eventId = entry.eventId
              terminalEventPublished ||= Boolean(terminalStatus)
            } catch (e) {
              // The event buffer (Redis replay store) rejected this event — e.g. the flush
              // batch exceeds the per-write byte cap for large block outputs. The buffer only
              // backs reconnect/replay; the live SSE stream is the primary delivery. Fall
              // through to enqueue the event live (below) instead of throwing, so terminal
              // events still reach the active client and the UI doesn't hang on "running".
              // Marking a terminal event delivered-live as published lets finalization close
              // the stream cleanly instead of aborting it with controller.error().
              reqLogger.warn('Event buffer write failed; delivering event over live stream only', {
                eventType: event.type,
                terminal: Boolean(terminalStatus),
                error: toError(e).message,
              })
              terminalEventPublished ||= Boolean(terminalStatus)
            }
          }
          if (!isStreamClosed) {
            try {
              controller.enqueue(encodeSSEEvent(eventToSend))
            } catch {
              isStreamClosed = true
            }
          }
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
            callbackData: any,
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
            const hasError = compactCallbackData.output?.error
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
                error: compactCallbackData.output.error,
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
                  error: compactCallbackData.output.error,
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

            // Sync window: attach sink before first await so pump delivers thinking/tools.
            const unsubscribe = forwardAgentStreamToExecutionEvents(streamingExec, {
              blockId,
              executionId,
              workflowId,
              sendEvent,
            })

            const reader = streamingExec.stream.getReader()
            const decoder = new TextDecoder()
            const cancelReader = () => {
              void reader.cancel(timeoutController.signal.reason).catch(() => {})
            }

            try {
              if (timeoutController.signal.aborted || isStreamClosed) return
              timeoutController.signal.addEventListener('abort', cancelReader, { once: true })

              while (true) {
                if (timeoutController.signal.aborted || isStreamClosed) break
                const { done, value } = await reader.read()
                if (timeoutController.signal.aborted || isStreamClosed) break
                if (done) break

                const chunk = decoder.decode(value, { stream: true })
                await sendEvent({
                  type: 'stream:chunk',
                  timestamp: new Date().toISOString(),
                  executionId,
                  workflowId,
                  data: { blockId, chunk },
                })
              }

              if (!timeoutController.signal.aborted && !isStreamClosed) {
                await sendEvent({
                  type: 'stream:done',
                  timestamp: new Date().toISOString(),
                  executionId,
                  workflowId,
                  data: { blockId },
                })
              }
            } catch (error) {
              if (!timeoutController.signal.aborted && !isStreamClosed) {
                reqLogger.error('Error streaming block content:', error)
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
            billingAttribution,
            sessionUserId: isClientSession ? userId : undefined,
            workflowUserId: workflow.userId,
            triggerType,
            triggerBlockId,
            useDraftState: shouldUseDraftState,
            startTime: new Date().toISOString(),
            isClientSession,
            enforceCredentialAccess: useAuthenticatedUserAsActor,
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
          })

          await handlePostExecutionPauseState({ result, workflowId, executionId, loggingSession })

          /**
           * Compact block logs once and reuse across cancelled/timeout/paused/complete
           * SSE events. Walks all block logs and durably serializes large values to
           * object storage, so doing it twice would double the latency and storage
           * load on the happy path.
           */
          const compactedBlockLogs = await compactBlockLogs(result.logs, {
            workspaceId,
            workflowId,
            executionId,
            userId: actorUserId,
            requireDurable: true,
          })

          if (result.status === 'cancelled') {
            if (timeoutController.isTimedOut() && timeoutController.timeoutMs) {
              const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
              reqLogger.info('Workflow execution timed out', {
                timeoutMs: timeoutController.timeoutMs,
              })

              await loggingSession.markAsFailed(timeoutErrorMessage)

              finalMetaStatus = 'error'
              await sendEvent(
                {
                  type: 'execution:error',
                  timestamp: new Date().toISOString(),
                  executionId,
                  workflowId,
                  data: {
                    error: timeoutErrorMessage,
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
          const isTimeout = isTimeoutError(error) || timeoutController.isTimedOut()
          const errorMessage = isTimeout
            ? getTimeoutErrorMessage(error, timeoutController.timeoutMs)
            : getErrorMessage(error, 'Unknown error')

          reqLogger.error(`SSE execution failed: ${errorMessage}`, { isTimeout })

          const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
          let compactErrorLogs: BlockLog[] | undefined
          try {
            compactErrorLogs = executionResult?.logs
              ? await compactBlockLogs(executionResult.logs, {
                  workspaceId,
                  workflowId,
                  executionId,
                  userId: actorUserId,
                  requireDurable: true,
                })
              : undefined
          } catch (compactionError) {
            reqLogger.warn('Failed to compact SSE error logs, omitting oversized error details', {
              error: toError(compactionError).message,
            })
          }

          finalMetaStatus = 'error'
          await sendEvent(
            {
              type: 'execution:error',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: {
                error: executionResult?.error || errorMessage,
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
            reqLogger.error('Failed to publish terminal execution event durably', {
              executionId,
              status: finalMetaStatus,
              replayBufferFlushed,
            })
            if (!isStreamClosed) {
              controller.error(new Error('Run buffer terminal event publish failed'))
              isStreamClosed = true
            }
          } else if (terminalEventPublished) {
            await eventWriter.close().catch((closeError) => {
              reqLogger.warn('Failed to close execution event writer after terminal publish', {
                executionId,
                error: getErrorMessage(closeError),
              })
            })
          } else {
            try {
              await eventWriter.close()
            } catch (closeError) {
              reqLogger.warn('Failed to close event writer', {
                error: toError(closeError).message,
              })
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
        timeoutController.abort()
        reqLogger.info('Client disconnected from SSE stream')
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
