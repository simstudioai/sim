import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { NextRequest } from 'next/server'
import { v2ResumeWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { WORKFLOW_EXECUTION_ID_HEADER } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { handleResumeExecution } from '@/app/api/resume/resume-handler'
import { type V2ErrorCode, v2Data, v2Error, v2ValidationError } from '@/app/api/v2/lib/response'
import { resolveV2WorkflowAccess } from '@/app/api/v2/workflows/lib/access'
import { classifyExecutionError } from '@/executor/utils/errors'

const logger = createLogger('V2WorkflowResumeAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ERROR_CODE_BY_STATUS: Record<number, V2ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'USAGE_LIMIT_EXCEEDED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  423: 'LOCKED',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
}

const TERMINAL_RESUME_STATUSES = new Set(['completed', 'failed', 'paused', 'cancelled'])

function errorMessage(payload: Record<string, unknown>): string {
  return typeof payload.error === 'string' ? payload.error : 'Resume execution failed'
}

/**
 * POST /api/v2/workflows/[id]/executions/[executionId]/resume resumes one pause
 * context on the parent execution. The new resume attempt gets its own
 * execution ID, which is the only polling handle exposed by v2.
 */
export const POST = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string; executionId: string }> }
  ) => {
    const { id: workflowId } = await context.params
    const access = await resolveV2WorkflowAccess(request, workflowId, 'write')
    if (!access.ok) return access.response

    const parsed = await parseRequest(v2ResumeWorkflowContract, request, context, {
      maxBodyBytes: 10 * 1024 * 1024,
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response
    const { executionId } = parsed.data.params
    const { contextId, input } = parsed.data.body

    if (!access.workflow.workspaceId) {
      return v2Error('INTERNAL_ERROR', 'Workflow has no associated workspace')
    }

    try {
      const response = await handleResumeExecution({
        request,
        workflowId,
        executionId,
        contextId,
        workspaceId: access.workflow.workspaceId,
        userId: access.userId,
        resumeInput: input === undefined ? {} : input,
        isApiCaller: true,
        pollingSurface: 'v2',
      })

      if (response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
        return response
      }

      const payload: unknown = await response.json()
      if (!isRecordLike(payload)) {
        return v2Error('INTERNAL_ERROR', 'Resume execution returned an invalid response')
      }

      if (!response.ok) {
        return v2Error(
          ERROR_CODE_BY_STATUS[response.status] ?? 'INTERNAL_ERROR',
          errorMessage(payload),
          { status: response.status }
        )
      }

      if (typeof payload.executionId !== 'string') {
        return v2Error('INTERNAL_ERROR', 'Resume execution did not return an execution ID')
      }

      const statusUrl = `${getBaseUrl()}/api/v2/workflows/${workflowId}/executions/${payload.executionId}`
      const headers = { [WORKFLOW_EXECUTION_ID_HEADER]: payload.executionId }

      if (response.status === 202 || payload.status === 'queued') {
        return v2Data(
          {
            executionId: payload.executionId,
            statusUrl,
            ...(typeof payload.queuePosition === 'number'
              ? { queuePosition: payload.queuePosition }
              : {}),
          },
          { status: 202, headers }
        )
      }

      if (typeof payload.status !== 'string' || !TERMINAL_RESUME_STATUSES.has(payload.status)) {
        return v2Error('INTERNAL_ERROR', 'Resume execution returned an invalid status')
      }

      const metadata = isRecordLike(payload.metadata) ? payload.metadata : undefined
      return v2Data(
        {
          executionId: payload.executionId,
          workflowId,
          status: payload.status as 'completed' | 'failed' | 'paused' | 'cancelled',
          output: payload.output ?? null,
          error:
            typeof payload.error === 'string'
              ? classifyExecutionError(new Error(payload.error))
              : null,
          startedAt:
            metadata && typeof metadata.startTime === 'string' ? metadata.startTime : undefined,
          endedAt: metadata && typeof metadata.endTime === 'string' ? metadata.endTime : undefined,
          durationMs:
            metadata && typeof metadata.duration === 'number' ? metadata.duration : undefined,
        },
        { headers }
      )
    } catch (error) {
      logger.error('Failed to resume workflow execution', {
        workflowId,
        executionId,
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
