import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
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

    // Log raw body shape for diagnostics (avoid dumping huge payloads)
    try {
      const bodyPreview = JSON.stringify(body).slice(0, 300)
      logger.debug(`[${tracker.requestId}] Incoming mark-complete raw body preview`, {
        preview: `${bodyPreview}${bodyPreview.length === 300 ? '...' : ''}`,
      })
    } catch {}

    const parsed = MarkCompleteSchema.parse(body)

    const messagePreview = (() => {
      try {
        const s =
          typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed.message)
        return s ? `${s.slice(0, 200)}${s.length > 200 ? '...' : ''}` : undefined
      } catch {
        return undefined
      }
    })()

    logger.info(`[${tracker.requestId}] Forwarding tool mark-complete`, {
      userId,
      toolCallId: parsed.id,
      toolName: parsed.name,
      status: parsed.status,
      hasMessage: parsed.message !== undefined,
      hasData: parsed.data !== undefined,
      messagePreview,
      agentUrl: `${SIM_AGENT_API_URL}/api/tools/mark-complete`,
    })

    const agentRes = await fetch(`${SIM_AGENT_API_URL}/api/tools/mark-complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify(parsed),
    })

    // Attempt to parse agent response JSON
    let agentJson: any = null
    let agentText: string | null = null
    try {
      agentJson = await agentRes.json()
    } catch (_) {
      try {
        agentText = await agentRes.text()
      } catch {}
    }

    logger.info(`[${tracker.requestId}] Agent responded to mark-complete`, {
      status: agentRes.status,
      ok: agentRes.ok,
      responseJsonPreview: agentJson ? JSON.stringify(agentJson).slice(0, 300) : undefined,
      responseTextPreview: agentText ? agentText.slice(0, 300) : undefined,
    })

    if (agentRes.ok) {
      return NextResponse.json({ success: true })
    }

    const errorMessage =
      agentJson?.error || agentText || `Agent responded with status ${agentRes.status}`
    const status = agentRes.status >= 500 ? 500 : 400

    logger.warn(`[${tracker.requestId}] Mark-complete failed`, {
      status,
      error: errorMessage,
    })

    return NextResponse.json({ success: false, error: errorMessage }, { status })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${tracker.requestId}] Invalid mark-complete request body`, {
        issues: error.issues,
      })
      return createBadRequestResponse('Invalid request body for mark-complete')
    }
    logger.error(`[${tracker.requestId}] Failed to proxy mark-complete:`, error)
    return createInternalServerErrorResponse('Failed to mark tool as complete')
  }
}
