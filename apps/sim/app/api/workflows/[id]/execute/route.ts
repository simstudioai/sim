import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId, isValidUuid } from '@sim/utils/id'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { executeWorkflowBodySchema } from '@/lib/api/contracts/workflows'
import { AuthType, checkHybridAuth, hasExternalApiCredentials } from '@/lib/auth/hybrid'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { getJobQueue, shouldExecuteInline } from '@/lib/core/async-jobs'
import {
  createTimeoutAbortController,
  getTimeoutErrorMessage,
  isTimeoutError,
} from '@/lib/core/execution-limits'
import { generateRequestId } from '@/lib/core/utils/request'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
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
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import {
  cleanupExecutionBase64Cache,
  hydrateUserFilesWithBase64,
} from '@/lib/uploads/utils/user-file-base64.server'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { type ExecutionEvent, encodeSSEEvent } from '@/lib/workflows/executor/execution-events'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { createStreamingResponse } from '@/lib/workflows/streaming/streaming'
import { createHttpResponseFromBlock, workflowHasResponseBlock } from '@/lib/workflows/utils'
import { executeWorkflowJob, type WorkflowExecutionPayload } from '@/background/workflow-execution'
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
import type { NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import { getExecutionErrorStatus, hasExecutionResult } from '@/executor/utils/errors'
import { Serializer } from '@/serializer'
import { CORE_TRIGGER_TYPES, type CoreTriggerType } from '@/stores/logs/filters/types'

const logger = createLogger('WorkflowExecuteAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

type AsyncExecutionParams = {
  requestId: string
  workflowId: string
  userId: string
  workspaceId: string
  input: any
  triggerType: CoreTriggerType
  executionId: string
  callChain?: string[]
}

async function handleAsyncExecution(params: AsyncExecutionParams): Promise<NextResponse> {
  const { requestId, workflowId, userId, workspaceId, input, triggerType, executionId, callChain } =
    params
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
    workspaceId,
    input,
    triggerType,
    executionId,
    requestId,
    correlation,
    callChain,
    executionMode: 'async',
  }

  try {
    const jobQueue = await getJobQueue()
    const jobId = await jobQueue.enqueue('workflow-execution', payload, {
      metadata: { workflowId, workspaceId, userId, correlation },
    })

    asyncLogger.info('Queued async workflow execution', { jobId })

    if (shouldExecuteInline()) {
      void (async () => {
        try {
          await jobQueue.startJob(jobId)
          const output = await executeWorkflowJob(payload)
          await jobQueue.completeJob(jobId, output)
        } catch (error) {
          const errorMessage = toError(error).message
          asyncLogger.error('Async workflow execution failed', {
            jobId,
            error: errorMessage,
          })
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

    return NextResponse.json(
      {
        success: true,
        async: true,
        jobId,
        executionId,
        message: 'Workflow execution queued',
        statusUrl: `${getBaseUrl()}/api/jobs/${jobId}`,
      },
      { status: 202 }
    )
  } catch (error: any) {
    asyncLogger.error('Failed to queue async execution', error)
    return NextResponse.json({ error: 'Failed to queue async execution' }, { status: 500 })
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

  try {
    const auth = await checkHybridAuth(req, { requireWorkflowId: false })

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
    const text = await req.text()
    if (text) {
      try {
        body = JSON.parse(text)
      } catch (error) {
        reqLogger.warn('Failed to parse request body', { error: toError(error).message })
        return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
      }
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
      triggerBlockId: parsedTriggerBlockId,
      startBlockId,
      stopAfterBlockId,
      runFromBlock: rawRunFromBlock,
    } = validation.data
    const triggerBlockId = parsedTriggerBlockId ?? startBlockId

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
      | { startBlockId: string; sourceSnapshot: SerializableExecutionState }
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
        const { getExecutionStateForWorkflow, getLatestExecutionState } = await import(
          '@/lib/workflows/executor/execution-state'
        )
        const snapshot =
          rawRunFromBlock.executionId === 'latest'
            ? await getLatestExecutionState(workflowId)
            : await getExecutionStateForWorkflow(rawRunFromBlock.executionId, workflowId)
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
    const input =
      isPublicApiAccess ||
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
              triggerBlockId: _triggerBlockId,
              stopAfterBlockId: _stopAfterBlockId,
              runFromBlock: _runFromBlock,
              workflowId: _workflowId, // Also exclude workflowId used for internal JWT auth
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

    const executionId = generateId()
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
    const loggingSession = new LoggingSession(
      workflowId,
      executionId,
      loggingTriggerType,
      requestId
    )

    // Client-side sessions and personal API keys bill/permission-check the
    // authenticated user, not the workspace billed account.
    const useAuthenticatedUserAsActor =
      isClientSession || (auth.authType === AuthType.API_KEY && auth.apiKeyType === 'personal')

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

    // Pass the pre-fetched workflow record to skip the redundant Step 1 DB query in preprocessing.
    const preprocessResult = await preprocessExecution({
      workflowId,
      userId,
      triggerType: loggingTriggerType,
      executionId,
      requestId,
      checkDeployment: !shouldUseDraftState,
      loggingSession,
      useDraftState: shouldUseDraftState,
      useAuthenticatedUserAsActor,
      workflowRecord: workflowAuthorization.workflow ?? undefined,
    })

    if (!preprocessResult.success) {
      return NextResponse.json(
        { error: preprocessResult.error!.message },
        { status: preprocessResult.error!.statusCode }
      )
    }

    const actorUserId = preprocessResult.actorUserId!
    const workflow = preprocessResult.workflowRecord!

    if (!workflow.workspaceId) {
      reqLogger.error('Workflow has no workspaceId')
      return NextResponse.json({ error: 'Workflow has no associated workspace' }, { status: 500 })
    }
    const workspaceId = workflow.workspaceId
    reqLogger = reqLogger.withMetadata({ workspaceId, userId: actorUserId })

    if (auth.apiKeyType === 'workspace' && auth.workspaceId !== workspaceId) {
      return NextResponse.json(
        { error: 'API key is not authorized for this workspace' },
        { status: 403 }
      )
    }

    reqLogger.info('Preprocessing passed')

    if (isAsyncMode) {
      return handleAsyncExecution({
        requestId,
        workflowId,
        userId: actorUserId,
        workspaceId,
        input,
        triggerType: loggingTriggerType,
        executionId,
        callChain,
      })
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
      const workflowData = shouldUseDraftState
        ? await loadWorkflowFromNormalizedTables(workflowId)
        : await loadDeployedWorkflowState(workflowId, workspaceId)

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

        const serializedWorkflow = new Serializer().serializeWorkflow(
          workflowData.blocks,
          workflowData.edges,
          workflowData.loops,
          workflowData.parallels,
          false
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

      await loggingSession.safeStart({
        userId: actorUserId,
        workspaceId,
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message: `File processing failed: ${fileError instanceof Error ? fileError.message : 'Unable to process input files'}`,
          stackTrace: fileError instanceof Error ? fileError.stack : undefined,
        },
        traceSpans: [],
      })

      return NextResponse.json(
        {
          error: `File processing failed: ${fileError instanceof Error ? fileError.message : 'Unable to process input files'}`,
        },
        { status: 400 }
      )
    }

    const effectiveWorkflowStateOverride =
      sanitizedWorkflowStateOverride || cachedWorkflowData || undefined

    if (!enableSSE) {
      reqLogger.info('Using non-SSE execution (direct JSON response)')
      const metadata: ExecutionMetadata = {
        requestId,
        executionId,
        workflowId,
        workspaceId,
        userId: actorUserId,
        sessionUserId: isClientSession ? userId : undefined,
        workflowUserId: workflow.userId,
        triggerType,
        triggerBlockId,
        useDraftState: shouldUseDraftState,
        startTime: new Date().toISOString(),
        isClientSession,
        enforceCredentialAccess: useAuthenticatedUserAsActor,
        workflowStateOverride: effectiveWorkflowStateOverride,
        callChain,
        executionMode: 'sync',
      }

      const executionVariables = cachedWorkflowData?.variables ?? workflow.variables ?? {}

      const timeoutController = createTimeoutAbortController(
        preprocessResult.executionTimeout?.sync
      )

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
          timeoutController.isTimedOut() &&
          timeoutController.timeoutMs
        ) {
          const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
          reqLogger.info('Non-SSE execution timed out', {
            timeoutMs: timeoutController.timeoutMs,
          })
          await loggingSession.markAsFailed(timeoutErrorMessage)

          return NextResponse.json(
            {
              success: false,
              output: result.output,
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

        const outputWithBase64 = includeFileBase64
          ? ((await hydrateUserFilesWithBase64(result.output, {
              requestId,
              executionId,
              maxBytes: base64MaxBytes,
            })) as NormalizedBlockOutput)
          : result.output

        const resultWithBase64 = { ...result, output: outputWithBase64 }

        if (auth.authType !== AuthType.INTERNAL_JWT && workflowHasResponseBlock(resultWithBase64)) {
          return createHttpResponseFromBlock(resultWithBase64)
        }

        const filteredResult = {
          success: result.success,
          executionId,
          output: outputWithBase64,
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
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        reqLogger.error(`Non-SSE execution failed: ${errorMessage}`)

        const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
        const status = getExecutionErrorStatus(error)

        return NextResponse.json(
          {
            success: false,
            output: executionResult?.output,
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
        },
        executionId,
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
            },
            executionId
          ),
      })

      return new NextResponse(stream, {
        status: 200,
        headers: SSE_HEADERS,
      })
    }

    const encoder = new TextEncoder()
    const timeoutController = createTimeoutAbortController(preprocessResult.executionTimeout?.sync)
    let isStreamClosed = false
    let isManualAbortRegistered = false

    const eventWriter = createExecutionEventWriter(executionId)
    const metaInitialized = await initializeExecutionStreamMeta(executionId, {
      userId: actorUserId,
      workflowId,
    })
    if (!metaInitialized) {
      timeoutController.cleanup()
      return NextResponse.json(
        { error: 'Run buffer temporarily unavailable' },
        { status: 503, headers: { 'X-Execution-Id': executionId } }
      )
    }

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
          const isBuffered = event.type !== 'stream:chunk' && event.type !== 'stream:done'
          if (isBuffered) {
            const entry = terminalStatus
              ? await eventWriter.writeTerminal(event, terminalStatus)
              : await eventWriter.write(event)
            event.eventId = entry.eventId
            terminalEventPublished ||= Boolean(terminalStatus)
          }
          if (!isStreamClosed) {
            try {
              controller.enqueue(encodeSSEEvent(event))
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
            const hasError = callbackData.output?.error
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
                error: callbackData.output.error,
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
                  input: callbackData.input,
                  error: callbackData.output.error,
                  durationMs: callbackData.executionTime || 0,
                  startedAt: callbackData.startedAt,
                  executionOrder: callbackData.executionOrder,
                  endedAt: callbackData.endedAt,
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
                  input: callbackData.input,
                  output: callbackData.output,
                  durationMs: callbackData.executionTime || 0,
                  startedAt: callbackData.startedAt,
                  executionOrder: callbackData.executionOrder,
                  endedAt: callbackData.endedAt,
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

            const reader = streamingExec.stream.getReader()
            const decoder = new TextDecoder()

            try {
              while (true) {
                const { done, value } = await reader.read()
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

              await sendEvent({
                type: 'stream:done',
                timestamp: new Date().toISOString(),
                executionId,
                workflowId,
                data: { blockId },
              })
            } catch (error) {
              reqLogger.error('Error streaming block content:', error)
            } finally {
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
            sessionUserId: isClientSession ? userId : undefined,
            workflowUserId: workflow.userId,
            triggerType,
            triggerBlockId,
            useDraftState: shouldUseDraftState,
            startTime: new Date().toISOString(),
            isClientSession,
            enforceCredentialAccess: useAuthenticatedUserAsActor,
            workflowStateOverride: effectiveWorkflowStateOverride,
            callChain,
            executionMode: 'sync',
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
                    finalBlockLogs: result.logs,
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
                    finalBlockLogs: result.logs,
                  },
                },
                'cancelled'
              )
            }
            return
          }

          const sseOutput = includeFileBase64
            ? await hydrateUserFilesWithBase64(result.output, {
                requestId,
                executionId,
                maxBytes: base64MaxBytes,
              })
            : result.output

          if (result.status === 'paused') {
            finalMetaStatus = 'complete'
            await sendEvent(
              {
                type: 'execution:paused',
                timestamp: new Date().toISOString(),
                executionId,
                workflowId,
                data: {
                  output: sseOutput,
                  duration: result.metadata?.duration || 0,
                  startTime: result.metadata?.startTime || startTime.toISOString(),
                  endTime: result.metadata?.endTime || new Date().toISOString(),
                  finalBlockLogs: result.logs,
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
                  output: sseOutput,
                  duration: result.metadata?.duration || 0,
                  startTime: result.metadata?.startTime || startTime.toISOString(),
                  endTime: result.metadata?.endTime || new Date().toISOString(),
                  finalBlockLogs: result.logs,
                },
              },
              'complete'
            )
          }
        } catch (error: unknown) {
          const isTimeout = isTimeoutError(error) || timeoutController.isTimedOut()
          const errorMessage = isTimeout
            ? getTimeoutErrorMessage(error, timeoutController.timeoutMs)
            : error instanceof Error
              ? error.message
              : 'Unknown error'

          reqLogger.error(`SSE execution failed: ${errorMessage}`, { isTimeout })

          const executionResult = hasExecutionResult(error) ? error.executionResult : undefined

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
                finalBlockLogs: executionResult?.logs,
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
                error: closeError instanceof Error ? closeError.message : String(closeError),
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
        reqLogger.info('Client disconnected from SSE stream')
      },
    })

    return new NextResponse(stream, {
      headers: {
        ...SSE_HEADERS,
        'X-Execution-Id': executionId,
      },
    })
  } catch (error: any) {
    reqLogger.error('Failed to start workflow execution:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to start workflow execution' },
      { status: 500 }
    )
  }
}
