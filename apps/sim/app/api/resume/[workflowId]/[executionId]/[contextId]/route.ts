import { describePrincipalAuth } from '@sim/auth/principal'
import { createLogger, setRequestAuth } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  getPauseContextDetailContract,
  resumeWorkflowExecutionContextContract,
} from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { InternalUnauthenticatedError } from '@/lib/api/server/routes'
import { withRequestId } from '@/lib/api/server/routes/request-id'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  internalWorkflowErrorPolicies,
  internalWorkflowSessionOrApiKeyAuth,
} from '@/lib/workflows/api'
import { resumeWorkflowRun } from '@/lib/workflows/application/resume-run'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import {
  ResumeWorkflowExecutionError,
  type ResumeWorkflowExecutionResult,
} from '@/lib/workflows/executor/resume-execution'
import { agentStreamProtocolResponseHeaders } from '@/lib/workflows/streaming/streaming'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { projectResolvedSecretDiagnosticError } from '@/executor/utils/resolved-secret-content-projection'

const logger = createLogger('WorkflowResumeAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function presentResumeResult(
  result: ResumeWorkflowExecutionResult,
  request: NextRequest
): NextResponse {
  switch (result.kind) {
    case 'queued':
      return NextResponse.json({
        status: 'queued',
        executionId: result.executionId,
        queuePosition: result.queuePosition,
        message: 'Resume queued. It will run after current resumes finish.',
      })
    case 'stream':
      return new NextResponse(result.stream, {
        headers: {
          ...SSE_HEADERS,
          ...agentStreamProtocolResponseHeaders({ requestHeaders: request.headers }),
          'X-Execution-Id': result.executionId,
        },
      })
    case 'sync':
      return NextResponse.json({
        success: result.success,
        status: result.status,
        executionId: result.executionId,
        output: result.output,
        error: result.error,
        metadata: result.metadata,
      })
    case 'async':
      return NextResponse.json(
        {
          success: true,
          async: true,
          jobId: result.jobId,
          executionId: result.executionId,
          message: 'Resume execution queued',
          statusUrl: `${getBaseUrl()}/api/jobs/${result.jobId}`,
        },
        { status: 202 }
      )
    case 'started':
      return NextResponse.json({
        status: 'started',
        executionId: result.executionId,
        message: 'Resume execution started.',
      })
  }
}

/**
 * Raw `withRouteHandler`: a resume can answer with an SSE stream as well as JSON,
 * which the JSON route builder cannot express. Admission still goes through
 * `resumeWorkflowRun`, so this surface enforces the same write policy as v2.
 */
export const POST = withRouteHandler(
  async (
    request: NextRequest,
    context: {
      params: Promise<{ workflowId: string; executionId: string; contextId: string }>
    }
  ) => {
    let principal
    try {
      principal = await internalWorkflowSessionOrApiKeyAuth.authenticate(
        request,
        await context.params
      )
    } catch (error) {
      if (error instanceof InternalUnauthenticatedError) {
        return NextResponse.json(withRequestId({ error: error.message }), { status: 401 })
      }
      throw error
    }
    setRequestAuth(describePrincipalAuth(principal))

    const parsed = await parseRequest(resumeWorkflowExecutionContextContract, request, context)
    if (!parsed.success) return parsed.response
    const { workflowId, executionId, contextId } = parsed.data.params

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

    try {
      const result = await resumeWorkflowRun.execute({
        principal,
        input: {
          workflowId,
          runId: executionId,
          contextId,
          resumeInput,
          surface: 'legacy',
        },
        request,
      })
      return presentResumeResult(result, request)
    } catch (error) {
      const projected = internalWorkflowErrorPolicies.concealRunAuthorization.project(error)
      if (projected) {
        return NextResponse.json(withRequestId(projected.body), {
          status: projected.status,
          headers: projected.headers,
        })
      }
      if (error instanceof ResumeWorkflowExecutionError) {
        return NextResponse.json({ error: error.message }, { status: error.statusCode })
      }
      logger.error(
        'Resume request failed',
        projectResolvedSecretDiagnosticError(error, undefined, {
          workflowId,
          executionId,
          contextId,
        })
      )
      return NextResponse.json(
        { error: toError(error).message || 'Failed to queue resume request' },
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
    const { workflowId: requestedWorkflowId } = await context.params
    const access = await validateWorkflowAccess(request, requestedWorkflowId, false)
    if (access.error) {
      return NextResponse.json({ error: access.error.message }, { status: access.error.status })
    }

    const parsed = await parseRequest(getPauseContextDetailContract, request, context)
    if (!parsed.success) return parsed.response
    const { workflowId, executionId, contextId } = parsed.data.params

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
