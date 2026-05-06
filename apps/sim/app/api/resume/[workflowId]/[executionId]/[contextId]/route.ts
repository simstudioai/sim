import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { resumeWorkflowExecutionContextContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { AuthType } from '@/lib/auth/hybrid'
import { getJobQueue } from '@/lib/core/async-jobs'
import { generateRequestId } from '@/lib/core/utils/request'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { createStreamingResponse } from '@/lib/workflows/streaming/streaming'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import type { ResumeExecutionPayload } from '@/background/resume-execution'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { SerializedSnapshot } from '@/executor/types'

const logger = createLogger('WorkflowResumeAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getStoredSnapshotConfig(pausedExecution: { executionSnapshot: unknown }): {
  executionMode?: 'sync' | 'stream' | 'async'
  selectedOutputs?: string[]
} {
  try {
    const serialized = pausedExecution.executionSnapshot as SerializedSnapshot
    const snapshot = ExecutionSnapshot.fromJSON(serialized.snapshot)
    return {
      executionMode: snapshot.metadata.executionMode,
      selectedOutputs: snapshot.selectedOutputs,
    }
  } catch {
    return {}
  }
}

export const POST = withRouteHandler(
  async (
    request: NextRequest,
    context: {
      params: Promise<{ workflowId: string; executionId: string; contextId: string }>
    }
  ) => {
    const parsed = await parseRequest(resumeWorkflowExecutionContextContract, request, context)
    if (!parsed.success) return parsed.response
    const { workflowId, executionId, contextId } = parsed.data.params

    const access = await validateWorkflowAccess(request, workflowId, false)
    if (access.error) {
      return NextResponse.json({ error: access.error.message }, { status: access.error.status })
    }

    const workflow = access.workflow

    let payload: unknown = {}
    try {
      payload = await request.json()
    } catch {
      payload = {}
    }

    const resumeInput =
      typeof payload === 'object' && payload !== null && 'input' in payload
        ? payload.input
        : (payload ?? {})
    const isPersonalApiKeyCaller =
      access.auth?.authType === AuthType.API_KEY && access.auth?.apiKeyType === 'personal'

    let userId: string
    if (isPersonalApiKeyCaller && access.auth?.userId) {
      userId = access.auth.userId
    } else {
      const billedAccountUserId = await getWorkspaceBilledAccountUserId(workflow.workspaceId)
      if (!billedAccountUserId) {
        logger.error('Unable to resolve workspace billed account for resume execution', {
          workflowId,
          workspaceId: workflow.workspaceId,
        })
        return NextResponse.json(
          { error: 'Unable to resolve billing account for this workspace' },
          { status: 500 }
        )
      }
      userId = billedAccountUserId
    }

    const resumeExecutionId = generateId()
    const requestId = generateRequestId()

    logger.info(`[${requestId}] Preprocessing resume execution`, {
      workflowId,
      parentExecutionId: executionId,
      resumeExecutionId,
      userId,
    })

    const preprocessResult = await preprocessExecution({
      workflowId,
      userId,
      triggerType: 'manual',
      executionId: resumeExecutionId,
      requestId,
      checkRateLimit: false,
      checkDeployment: false,
      skipUsageLimits: true,
      useAuthenticatedUserAsActor: isPersonalApiKeyCaller,
      workspaceId: workflow.workspaceId || undefined,
    })

    if (!preprocessResult.success) {
      logger.warn(`[${requestId}] Preprocessing failed for resume`, {
        workflowId,
        parentExecutionId: executionId,
        error: preprocessResult.error?.message,
        statusCode: preprocessResult.error?.statusCode,
      })

      return NextResponse.json(
        {
          error:
            preprocessResult.error?.message ||
            'Failed to validate resume execution. Please try again.',
        },
        { status: preprocessResult.error?.statusCode || 400 }
      )
    }

    logger.info(`[${requestId}] Preprocessing passed, proceeding with resume`, {
      workflowId,
      parentExecutionId: executionId,
      resumeExecutionId,
      actorUserId: preprocessResult.actorUserId,
    })

    try {
      const enqueueResult = await PauseResumeManager.enqueueOrStartResume({
        executionId,
        contextId,
        resumeInput,
        userId,
        allowedPauseKinds: ['human'],
      })

      if (enqueueResult.status === 'queued') {
        return NextResponse.json({
          status: 'queued',
          executionId: enqueueResult.resumeExecutionId,
          queuePosition: enqueueResult.queuePosition,
          message: 'Resume queued. It will run after current resumes finish.',
        })
      }

      const resumeArgs = {
        resumeEntryId: enqueueResult.resumeEntryId,
        resumeExecutionId: enqueueResult.resumeExecutionId,
        pausedExecution: enqueueResult.pausedExecution,
        contextId: enqueueResult.contextId,
        resumeInput: enqueueResult.resumeInput,
        userId: enqueueResult.userId,
      }

      const isApiCaller = access.auth?.authType === AuthType.API_KEY
      const snapshotConfig = isApiCaller
        ? getStoredSnapshotConfig(enqueueResult.pausedExecution)
        : {}
      const executionMode = isApiCaller ? (snapshotConfig.executionMode ?? 'sync') : undefined

      if (isApiCaller && executionMode === 'stream') {
        const stream = await createStreamingResponse({
          requestId,
          streamConfig: {
            selectedOutputs: snapshotConfig.selectedOutputs,
            timeoutMs: preprocessResult.executionTimeout?.sync,
          },
          executionId: enqueueResult.resumeExecutionId,
          executeFn: async ({ onStream, onBlockComplete, abortSignal }) =>
            PauseResumeManager.startResumeExecution({
              ...resumeArgs,
              onStream,
              onBlockComplete,
              abortSignal,
            }),
        })

        return new NextResponse(stream, {
          headers: {
            ...SSE_HEADERS,
            'X-Execution-Id': enqueueResult.resumeExecutionId,
          },
        })
      }

      if (isApiCaller && executionMode === 'sync') {
        const result = await PauseResumeManager.startResumeExecution(resumeArgs)

        return NextResponse.json({
          success: result.success,
          status: result.status ?? (result.success ? 'completed' : 'failed'),
          executionId: enqueueResult.resumeExecutionId,
          output: result.output,
          error: result.error,
          metadata: result.metadata
            ? {
                duration: result.metadata.duration,
                startTime: result.metadata.startTime,
                endTime: result.metadata.endTime,
              }
            : undefined,
        })
      }

      if (isApiCaller && executionMode === 'async') {
        const resumePayload: ResumeExecutionPayload = {
          resumeEntryId: enqueueResult.resumeEntryId,
          resumeExecutionId: enqueueResult.resumeExecutionId,
          pausedExecutionId: enqueueResult.pausedExecution.id,
          contextId: enqueueResult.contextId,
          resumeInput: enqueueResult.resumeInput,
          userId: enqueueResult.userId,
          workflowId,
          parentExecutionId: executionId,
        }

        let jobId: string
        try {
          const jobQueue = await getJobQueue()
          jobId = await jobQueue.enqueue('resume-execution', resumePayload, {
            metadata: { workflowId, workspaceId: workflow.workspaceId, userId },
          })
          logger.info('Enqueued async resume execution', {
            jobId,
            resumeExecutionId: enqueueResult.resumeExecutionId,
          })
        } catch (dispatchError) {
          logger.error('Failed to dispatch async resume execution', {
            error: toError(dispatchError).message,
            resumeExecutionId: enqueueResult.resumeExecutionId,
          })
          await PauseResumeManager.markResumeAttemptFailed({
            resumeEntryId: enqueueResult.resumeEntryId,
            pausedExecutionId: enqueueResult.pausedExecution.id,
            parentExecutionId: executionId,
            contextId: enqueueResult.contextId,
            failureReason: 'Failed to queue async resume execution',
          })
          await PauseResumeManager.processQueuedResumes(executionId)
          return NextResponse.json(
            { error: 'Failed to queue resume execution. Please try again.' },
            { status: 503 }
          )
        }

        return NextResponse.json(
          {
            success: true,
            async: true,
            jobId,
            executionId: enqueueResult.resumeExecutionId,
            message: 'Resume execution queued',
            statusUrl: `${getBaseUrl()}/api/jobs/${jobId}`,
          },
          { status: 202 }
        )
      }

      PauseResumeManager.startResumeExecution(resumeArgs).catch((error) => {
        logger.error('Failed to start resume execution', {
          workflowId,
          parentExecutionId: executionId,
          resumeExecutionId: enqueueResult.resumeExecutionId,
          error,
        })
      })

      return NextResponse.json({
        status: 'started',
        executionId: enqueueResult.resumeExecutionId,
        message: 'Resume execution started.',
      })
    } catch (error: any) {
      logger.error('Resume request failed', {
        workflowId,
        executionId,
        contextId,
        error,
      })
      return NextResponse.json(
        { error: error.message || 'Failed to queue resume request' },
        { status: 400 }
      )
    }
  }
)

export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: {
      params: Promise<{ workflowId: string; executionId: string; contextId: string }>
    }
  ) => {
    const parsed = await parseRequest(resumeWorkflowExecutionContextContract, request, context)
    if (!parsed.success) return parsed.response
    const { workflowId, executionId, contextId } = parsed.data.params

    const access = await validateWorkflowAccess(request, workflowId, false)
    if (access.error) {
      return NextResponse.json({ error: access.error.message }, { status: access.error.status })
    }

    const detail = await PauseResumeManager.getPauseContextDetail({
      workflowId,
      executionId,
      contextId,
    })

    if (!detail) {
      return NextResponse.json({ error: 'Pause context not found' }, { status: 404 })
    }

    return NextResponse.json(detail)
  }
)
