import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agentCardOutput, createA2AClient } from '@/lib/a2a/client'
import { a2aGetAgentCardContract } from '@/lib/api/contracts/tools/a2a'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { enforceUserOrIpRateLimit } from '@/lib/core/rate-limiter'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const logger = createLogger('A2AGetAgentCardAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error || 'Authentication required' },
      { status: 401 }
    )
  }

  const rateLimited = await enforceUserOrIpRateLimit('a2a-get-agent-card', auth.userId, request)
  if (rateLimited) return rateLimited

  const parsed = await parseRequest(
    a2aGetAgentCardContract,
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
    const card = await client.getAgentCard()

    logger.info(`[${requestId}] Fetched agent card for ${card.name}`)
    return NextResponse.json({ success: true, output: agentCardOutput(card, body.agentUrl) })
  } catch (error) {
    logger.error(`[${requestId}] A2A get-agent-card failed`, { error: getErrorMessage(error) })
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 502 })
  }
})
