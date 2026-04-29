import { type NextRequest, NextResponse } from 'next/server'
import { copilotStatsBodySchema } from '@/lib/api/contracts/copilot'
import { validateSchema } from '@/lib/api/server'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const POST = withRouteHandler(async (req: NextRequest) => {
  const tracker = createRequestTracker()
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const json = await req.json().catch(() => ({}))
    const parsed = validateSchema(copilotStatsBodySchema, json)
    if (!parsed.success) {
      return createBadRequestResponse('Invalid request body for copilot stats')
    }

    const { messageId, diffCreated, diffAccepted } = parsed.data

    // Build outgoing payload for Sim Agent with only required fields
    const payload: Record<string, any> = {
      messageId,
      diffCreated,
      diffAccepted,
    }

    const agentRes = await fetchGo(`${SIM_AGENT_API_URL}/api/stats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify(payload),
      spanName: 'sim → go /api/stats',
      operation: 'stats_ingest',
    })

    // Prefer not to block clients; still relay status
    let agentJson: any = null
    try {
      agentJson = await agentRes.json()
    } catch {}

    if (!agentRes.ok) {
      const message = (agentJson && (agentJson.error || agentJson.message)) || 'Upstream error'
      return NextResponse.json({ success: false, error: message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return createInternalServerErrorResponse('Failed to forward copilot stats')
  }
})
