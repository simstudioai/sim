import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request-helpers'
import { env } from '@/lib/core/config/env'

const logger = createLogger('CopilotAutoAllowedToolsAPI')

function copilotHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }
  return headers
}

export async function DELETE(request: NextRequest) {
  const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
  if (!isAuthenticated || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const toolIdFromQuery = new URL(request.url).searchParams.get('toolId') || undefined
  const toolIdFromBody = await request
    .json()
    .then((body) => (typeof body?.toolId === 'string' ? body.toolId : undefined))
    .catch(() => undefined)
  const toolId = toolIdFromBody || toolIdFromQuery
  if (!toolId) {
    return NextResponse.json({ error: 'toolId is required' }, { status: 400 })
  }

  try {
    const res = await fetch(`${SIM_AGENT_API_URL}/api/tool-preferences/auto-allowed`, {
      method: 'DELETE',
      headers: copilotHeaders(),
      body: JSON.stringify({
        userId,
        toolId,
      }),
    })

    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      logger.warn('Failed to remove auto-allowed tool via copilot backend', {
        status: res.status,
        userId,
        toolId,
      })
      return NextResponse.json(
        {
          success: false,
          error: payload?.error || 'Failed to remove auto-allowed tool',
          autoAllowedTools: [],
        },
        { status: res.status }
      )
    }

    return NextResponse.json({
      success: true,
      autoAllowedTools: Array.isArray(payload?.autoAllowedTools) ? payload.autoAllowedTools : [],
    })
  } catch (error) {
    logger.error('Error removing auto-allowed tool', {
      userId,
      toolId,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to remove auto-allowed tool',
        autoAllowedTools: [],
      },
      { status: 500 }
    )
  }
}
