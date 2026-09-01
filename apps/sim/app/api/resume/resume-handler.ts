import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  executeResumeWorkflow,
  ResumeWorkflowExecutionError,
  type ResumeWorkflowExecutionResult,
} from '@/lib/workflows/executor/resume-execution'
import { agentStreamProtocolResponseHeaders } from '@/lib/workflows/streaming/streaming'
import { projectResolvedSecretDiagnosticError } from '@/executor/utils/resolved-secret-content-projection'

const logger = createLogger('WorkflowResumeAPI')

interface HandleResumeExecutionOptions {
  request: NextRequest
  workflowId: string
  executionId: string
  contextId: string
  workspaceId: string
  userId: string
  resumeInput: unknown
  isApiCaller: boolean
  pollingSurface: 'legacy' | 'v2'
  allowStreaming?: boolean
}

function presentResumeResult(
  result: ResumeWorkflowExecutionResult,
  request: NextRequest,
  workflowId: string,
  pollingSurface: 'legacy' | 'v2'
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
          ...(pollingSurface === 'legacy' ? { jobId: result.jobId } : {}),
          executionId: result.executionId,
          message: 'Resume execution queued',
          statusUrl:
            pollingSurface === 'legacy'
              ? `${getBaseUrl()}/api/jobs/${result.jobId}`
              : `${getBaseUrl()}/api/v2/workflows/${workflowId}/runs/${result.executionId}`,
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

/** Adapts the transport-neutral resume transition to the legacy response contract. */
export async function handleResumeExecution({
  request,
  workflowId,
  executionId,
  contextId,
  workspaceId,
  userId,
  resumeInput,
  isApiCaller,
  pollingSurface,
  allowStreaming = true,
}: HandleResumeExecutionOptions): Promise<NextResponse> {
  try {
    const result = await executeResumeWorkflow({
      workflowId,
      executionId,
      contextId,
      workspaceId,
      userId,
      resumeInput,
      isApiCaller,
      pollingSurface,
      allowStreaming,
      requestSignal: request.signal,
      requestHeaders: request.headers,
    })
    return presentResumeResult(result, request, workflowId, pollingSurface)
  } catch (error) {
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
