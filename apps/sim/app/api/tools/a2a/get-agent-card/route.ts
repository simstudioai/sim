import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createA2AClient } from '@/lib/a2a/utils'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'

export const dynamic = 'force-dynamic'

const logger = createLogger('A2AGetAgentCardAPI')

const A2AGetAgentCardSchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
  apiKey: z.string().optional(),
})

export async function POST(request: NextRequest) {
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

    logger.info(
      `[${requestId}] Authenticated A2A get agent card request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = A2AGetAgentCardSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error fetching Agent Card:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch Agent Card',
      },
      { status: 500 }
    )
  }
}
