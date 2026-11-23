import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { wandGenerateContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { authenticateOptionalInternalSession } from '@/lib/api/server/routes'
import {
  asOrchestrationError,
  OrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  generateWandForWorkflow,
  generateWandInWorkspace,
  WAND_DEPLOYMENT,
  WandBillingRefusedError,
  WandEmptyResponseError,
  WandNotConfiguredError,
  WandStreamStartError,
  WandWorkflowDetachedError,
  WandWorkflowNotFoundError,
} from '@/lib/wand/application/generate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const logger = createLogger('WandGenerateAPI')

const WORKSPACE_REQUIRED = 'Workspace context is required.'

function wandError(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status })
}

function errorDetails(error: unknown) {
  if (!(error instanceof Error)) return { message: 'Unknown error' }
  return {
    name: error.name,
    message: error.message || 'Unknown error',
    code: 'code' in error ? error.code : undefined,
    status: 'status' in error ? error.status : undefined,
    stack: error.stack,
  }
}

/** Projects a refusal the use case raised, or `null` for a generation failure. */
function refusalResponse(error: unknown, target: 'workflow' | 'workspace'): NextResponse | null {
  if (error instanceof WandWorkflowNotFoundError) return wandError(error.message, 404)
  if (error instanceof WandWorkflowDetachedError) return wandError(error.message, 403)
  if (
    error instanceof OrchestrationError &&
    (error.code === 'forbidden' || error.code === 'not_found')
  ) {
    if (target === 'workspace') return wandError(WORKSPACE_REQUIRED, 400)
    logger.warn('Wand caller lacks write access to the workflow workspace')
    return wandError('Unauthorized', 403)
  }
  if (error instanceof WandNotConfiguredError) return wandError(error.message, 503)
  if (error instanceof WandBillingRefusedError) {
    return wandError(error.message, 402, { scope: error.scope })
  }
  if (error instanceof WandEmptyResponseError) {
    return wandError('Failed to generate content. AI response was empty.', 500)
  }
  if (error instanceof WandStreamStartError) {
    logger.error('Failed to create stream', { ...errorDetails(error.cause), ...WAND_DEPLOYMENT })
    return wandError('An error occurred during wand generation streaming.', 500)
  }
  return null
}

function generationFailedResponse(error: unknown): NextResponse {
  logger.error('Wand generation failed', { ...errorDetails(error), ...WAND_DEPLOYMENT })

  let clientErrorMessage = 'Wand generation failed. Please try again later.'
  let status =
    error instanceof Error && 'status' in error && typeof error.status === 'number'
      ? error.status
      : 500

  if (
    WAND_DEPLOYMENT.useWandAzure &&
    error instanceof Error &&
    error.message.includes('DeploymentNotFound')
  ) {
    clientErrorMessage =
      'Azure OpenAI deployment not found. Please check your model deployment configuration.'
    status = 404
  } else if (status === 401) {
    clientErrorMessage = 'Authentication failed. Please check your API key configuration.'
  } else if (status === 429) {
    clientErrorMessage = 'Rate limit exceeded. Please try again later.'
  } else if (status >= 500) {
    clientErrorMessage =
      'The wand generation service is currently unavailable. Please try again later.'
  }

  return wandError(clientErrorMessage, status)
}

export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()
  logger.info('Received wand generation request')

  const principal = await authenticateOptionalInternalSession()
  if (!principal) {
    logger.warn('Unauthorized wand generation attempt')
    return wandError('Unauthorized', 401)
  }

  let target: 'workflow' | 'workspace' | undefined
  try {
    const parsed = await parseRequest(wandGenerateContract, req, {})
    if (!parsed.success) return parsed.response
    const { workflowId, workspaceId, ...generation } = parsed.data.body
    const request = { ...generation, requestId }

    let result
    if (workflowId) {
      target = 'workflow'
      result = await generateWandForWorkflow.execute({
        principal,
        input: { ...request, workflowId },
      })
    } else if (workspaceId) {
      target = 'workspace'
      result = await generateWandInWorkspace.execute({
        principal,
        input: { ...request, workspaceId },
      })
    } else {
      // Per-member usage must be attributable to an org workspace. The editor always
      // supplies a workflow or a workspace the caller belongs to; refuse to run rather
      // than stamp usage workspace-less (which would silently skip the per-member cap).
      return wandError(WORKSPACE_REQUIRED, 400)
    }

    if (result.kind === 'content') {
      return NextResponse.json({ success: true, content: result.content })
    }
    return new Response(result.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error) {
    const orchestrationError = asOrchestrationError(error)
    if (orchestrationError?.code === 'unavailable') {
      logger.error('Wand generation unavailable', { ...errorDetails(error), ...WAND_DEPLOYMENT })
      return wandError(orchestrationError.message, statusForOrchestrationError('unavailable'))
    }
    return (target && refusalResponse(error, target)) || generationFailedResponse(error)
  }
})
