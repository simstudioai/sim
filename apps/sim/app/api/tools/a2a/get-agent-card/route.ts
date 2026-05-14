import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { createA2AClient } from '@/lib/a2a/utils'
import { a2aGetAgentCardContract } from '@/lib/api/contracts/tools/a2a'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { enforceUserOrIpRateLimit } from '@/lib/core/rate-limiter'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('A2AGetAgentCardAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized A2A get agent card attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const rateLimited = await enforceUserOrIpRateLimit(
      'a2a-get-agent-card',
      authResult.userId,
      request
    )
    if (rateLimited) return rateLimited

    logger.info(
      `[${requestId}] Authenticated A2A get agent card request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const parsed = await parseRequest(
      a2aGetAgentCardContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid request data'),
              details: error.issues,
            },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Fetching Agent Card`, {
      agentUrl: validatedData.agentUrl,
    })

    const client = await createA2AClient(validatedData.agentUrl, validatedData.apiKey)

    const agentCard = await client.getAgentCard()

    logger.info(`[${requestId}] Agent Card fetched successfully`, {
      agentName: agentCard.name,
    })

    return NextResponse.json({
      success: true,
      output: {
        name: agentCard.name,
        description: agentCard.description,
        url: agentCard.url,
        version: agentCard.protocolVersion,
        capabilities: agentCard.capabilities,
        skills: agentCard.skills,
        defaultInputModes: agentCard.defaultInputModes,
        defaultOutputModes: agentCard.defaultOutputModes,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Agent Card:`, error)

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch Agent Card',
      },
      { status: 500 }
    )
  }
})
