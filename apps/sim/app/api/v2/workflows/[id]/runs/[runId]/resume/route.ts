import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import type { V2ErrorCode } from '@/lib/api/contracts/v2/error-codes'
import {
  V2_WORKFLOW_RUN_ID_HEADER,
  v2ResumeWorkflowContract,
} from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import {
  admitV2Request,
  V2_PARSE_DEFAULTS,
  V2RouteInfrastructureError,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resumeWorkflowRun } from '@/lib/workflows/application/resume-run'
import { ResumeWorkflowExecutionError } from '@/lib/workflows/executor/resume-execution'
import { v2Data, v2Error } from '@/app/api/v2/lib/response'
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

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; runId: string }> }) => {
    const admission = await admitV2Request(
      request,
      workflowOperations.resumeRun,
      v2ApiKeyAuth,
      v2RateLimits.publicApi
    )
    if (!admission.success) return admission.response

    const parsed = await parseRequest(v2ResumeWorkflowContract, request, context, {
      ...V2_PARSE_DEFAULTS,
      maxBodyBytes: 10 * 1024 * 1024,
    })
    if (!parsed.success) return parsed.response
    const { id: workflowId, runId } = parsed.data.params
    const { contextId, input } = parsed.data.body

    try {
      const result = await resumeWorkflowRun.execute({
        principal: admission.auth.principal,
        input: {
          workflowId,
          runId,
          contextId,
          resumeInput: input === undefined ? {} : input,
        },
        request,
      })

      const statusUrl = `${getBaseUrl()}/api/v2/workflows/${workflowId}/runs/${result.executionId}`
      const headers = { [V2_WORKFLOW_RUN_ID_HEADER]: result.executionId }
      if (result.kind === 'async' || result.kind === 'queued') {
        return v2Data(
          {
            runId: result.executionId,
            statusUrl,
            ...(result.kind === 'queued' ? { queuePosition: result.queuePosition } : {}),
          },
          { status: 202, headers }
        )
      }
      if (result.kind !== 'sync' || !TERMINAL_RESUME_STATUSES.has(result.status)) {
        return v2Error('INTERNAL_ERROR', 'Resume execution returned an invalid status')
      }

      return v2Data(
        {
          runId: result.executionId,
          workflowId,
          status: result.status as 'completed' | 'failed' | 'paused' | 'cancelled',
          output: result.output ?? null,
          error:
            typeof result.error === 'string'
              ? classifyExecutionError(new Error(result.error))
              : null,
          startedAt: result.metadata?.startTime,
          endedAt: result.metadata?.endTime,
          durationMs: result.metadata?.duration,
        },
        { headers }
      )
    } catch (error) {
      const domainResponse = v2WorkflowErrorPolicies.concealRunAuthorization.render(error)
      if (domainResponse) return domainResponse
      if (error instanceof ResumeWorkflowExecutionError) {
        if (!error.safeForPublicApi) throw error
        return v2Error(ERROR_CODE_BY_STATUS[error.statusCode] ?? 'INTERNAL_ERROR', error.message, {
          status: error.statusCode,
        })
      }
      logger.error('Failed to resume workflow run', {
        workflowId,
        runId,
        error: getErrorMessage(error, 'Unknown error'),
      })
      throw error
    }
  },
  {
    unhandledErrorResponse: ({ error }) =>
      error instanceof V2RouteInfrastructureError
        ? v2Error('SERVICE_UNAVAILABLE', 'Service temporarily unavailable')
        : v2Error('INTERNAL_ERROR', 'Internal server error'),
  }
)
