import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { env } from '@/lib/core/config/env'

const logger = createLogger('CopilotAutoAllowedToolsAPI')

/** Headers for server-to-server calls to the Go copilot backend. */
function copilotHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }
  return headers
}

/**
 * GET - Fetch user's auto-allowed integration tools
 */
export async function GET() {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const res = await fetch(
      `${SIM_AGENT_API_URL}/api/tool-preferences/auto-allowed?userId=${encodeURIComponent(userId)}`,
      { method: 'GET', headers: copilotHeaders() }
    )

    if (!res.ok) {
      logger.warn('Go backend returned error for list auto-allowed', { status: res.status })
      return NextResponse.json({ autoAllowedTools: [] })
    }

    const payload = await res.json()
    return NextResponse.json({ autoAllowedTools: payload?.autoAllowedTools || [] })
  } catch (error) {
    logger.error('Failed to fetch auto-allowed tools', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST - Add a tool to the auto-allowed list
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()

    if (!body.toolId || typeof body.toolId !== 'string') {
      return NextResponse.json({ error: 'toolId must be a string' }, { status: 400 })
    }

    const res = await fetch(`${SIM_AGENT_API_URL}/api/tool-preferences/auto-allowed`, {
      method: 'POST',
      headers: copilotHeaders(),
      body: JSON.stringify({ userId, toolId: body.toolId }),
    })

    if (!res.ok) {
      logger.warn('Go backend returned error for add auto-allowed', { status: res.status })
      return NextResponse.json({ error: 'Failed to add tool' }, { status: 500 })
    }

    const payload = await res.json()
    return NextResponse.json({
      success: true,
      autoAllowedTools: payload?.autoAllowedTools || [],
    })
  } catch (error) {
    logger.error('Failed to add auto-allowed tool', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE - Remove a tool from the auto-allowed list
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const { searchParams } = new URL(request.url)
    const toolId = searchParams.get('toolId')

    if (!toolId) {
      return NextResponse.json({ error: 'toolId query parameter is required' }, { status: 400 })
    }

    const res = await fetch(
      `${SIM_AGENT_API_URL}/api/tool-preferences/auto-allowed?userId=${encodeURIComponent(userId)}&toolId=${encodeURIComponent(toolId)}`,
      { method: 'DELETE', headers: copilotHeaders() }
    )

    if (!res.ok) {
      logger.warn('Go backend returned error for remove auto-allowed', { status: res.status })
      return NextResponse.json({ error: 'Failed to remove tool' }, { status: 500 })
    }

    const payload = await res.json()
    return NextResponse.json({
      success: true,
      autoAllowedTools: payload?.autoAllowedTools || [],
    })
  } catch (error) {
    logger.error('Failed to remove auto-allowed tool', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
