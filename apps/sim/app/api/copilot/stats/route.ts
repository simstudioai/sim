import { type NextRequest, NextResponse } from 'next/server'
import { copilotStatsContract } from '@/lib/api/contracts/copilot'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { getMothershipBaseURL } from '@/lib/copilot/server/agent-url'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const POST = withRouteHandler(async (req: NextRequest) => {
  const tracker = createRequestTracker()
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const parsed = await parseRequest(
      copilotStatsContract,
      req,
      {},
      {
        validationErrorResponse: (error) =>
          validationErrorResponse(error, 'Invalid request body for copilot stats'),
        invalidJsonResponse: () =>
          NextResponse.json(
            { error: 'Invalid request body for copilot stats', details: [] },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response

    const { messageId, diffCreated, diffAccepted } = parsed.data.body

    const payload: Record<string, any> = {
      messageId,
      diffCreated,
      diffAccepted,
    }

    const mothershipBaseURL = await getMothershipBaseURL({ userId })
    const agentRes = await fetchGo(`${mothershipBaseURL}/api/stats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify(payload),
      spanName: 'sim → go /api/stats',
      operation: 'stats_ingest',
    })

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
