import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { env } from '@/lib/env'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/sim-agent'

const logger = createLogger('CopilotMarkToolCompleteAPI')

// Sim Agent API configuration
const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

// Schema for mark-complete request
const MarkCompleteSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.number().int(),
  message: z.any().optional(),
  data: z.any().optional(),
})

/**
 * POST /api/copilot/tools/mark-complete
 * Proxy to Sim Agent: POST /api/tools/mark-complete
 */
export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    const parsed = MarkCompleteSchema.parse(body)

    logger.info(`[${tracker.requestId}] Forwarding tool mark-complete`, {
      userId,
      toolCallId: parsed.id,
      toolName: parsed.name,
      status: parsed.status,
    })

    const agentRes = await fetch(`${SIM_AGENT_API_URL}/api/tools/mark-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    })

    // Attempt to parse agent response JSON
    let agentJson: any = null
    try {
      agentJson = await agentRes.json()
    } catch (_) {
      // ignore JSON parse errors
    }

    if (agentRes.ok) {
      return NextResponse.json({ success: true })
    }

    const errorMessage = agentJson?.error || `Agent responded with status ${agentRes.status}`
    const status = agentRes.status >= 500 ? 500 : 400
    return NextResponse.json({ success: false, error: errorMessage }, { status })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createBadRequestResponse('Invalid request body for mark-complete')
    }
    logger.error(`[${tracker.requestId}] Failed to proxy mark-complete:`, error)
    return createInternalServerErrorResponse('Failed to mark tool as complete')
  }
} 