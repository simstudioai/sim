import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { createA2AClient, taskOutput } from '@/lib/a2a/client'
import { a2aCancelTaskContract } from '@/lib/api/contracts/tools/a2a'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { enforceUserOrIpRateLimit } from '@/lib/core/rate-limiter'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const logger = createLogger('A2ACancelTaskAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error || 'Authentication required' },
      { status: 401 }
    )
  }

  const rateLimited = await enforceUserOrIpRateLimit('a2a-cancel-task', auth.userId, request)
  if (rateLimited) return rateLimited

  const parsed = await parseRequest(
    a2aCancelTaskContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        NextResponse.json(
          { success: false, error: getValidationErrorMessage(error, 'Invalid request data') },
          { status: 400 }
        ),
    }
  )
  if (!parsed.success) return parsed.response
  const body = parsed.data.body

  try {
    const client = await createA2AClient(body.agentUrl, body.apiKey, { signal: request.signal })
    const task = await client.cancelTask({ tenant: '', id: body.taskId, metadata: undefined })
    const out = taskOutput(task)

    logger.info(`[${requestId}] Cancel requested for A2A task ${task.id}`)
    return NextResponse.json({
      success: true,
      output: { taskId: out.taskId, state: out.state, canceled: out.state === 'canceled' },
    })
  } catch (error) {
    logger.error(`[${requestId}] A2A cancel-task failed`, { error: getErrorMessage(error) })
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 502 })
  }
})
