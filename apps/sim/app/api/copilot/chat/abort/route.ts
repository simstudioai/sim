import { NextResponse } from 'next/server'
import { abortActiveStream } from '@/lib/copilot/chat-streaming'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request-helpers'
import { env } from '@/lib/core/config/env'

export async function POST(request: Request) {
  const { userId: authenticatedUserId, isAuthenticated } =
    await authenticateCopilotRequestSessionOnly()

  if (!isAuthenticated || !authenticatedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const streamId = typeof body.streamId === 'string' ? body.streamId : ''

  if (!streamId) {
    return NextResponse.json({ error: 'streamId is required' }, { status: 400 })
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (env.COPILOT_API_KEY) {
      headers['x-api-key'] = env.COPILOT_API_KEY
    }
    await fetch(`${SIM_AGENT_API_URL}/api/streams/explicit-abort`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messageId: streamId }),
    })
  } catch {
    // best effort: local abort should still proceed even if Go marker fails
  }

  const aborted = await abortActiveStream(streamId)
  return NextResponse.json({ aborted })
}
