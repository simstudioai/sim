import { NextResponse } from 'next/server'
import { getLatestRunForStream } from '@/lib/copilot/async-runs/repository'
import { abortActiveStream, waitForPendingChatStream } from '@/lib/copilot/chat-streaming'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request-helpers'
import { env } from '@/lib/core/config/env'

const GO_EXPLICIT_ABORT_TIMEOUT_MS = 3000

export async function POST(request: Request) {
  const { userId: authenticatedUserId, isAuthenticated } =
    await authenticateCopilotRequestSessionOnly()

  if (!isAuthenticated || !authenticatedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const streamId = typeof body.streamId === 'string' ? body.streamId : ''
  let chatId = typeof body.chatId === 'string' ? body.chatId : ''

  if (!streamId) {
    return NextResponse.json({ error: 'streamId is required' }, { status: 400 })
  }

  if (!chatId) {
    const run = await getLatestRunForStream(streamId, authenticatedUserId).catch(() => null)
    if (run?.chatId) {
      chatId = run.chatId
    }
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (env.COPILOT_API_KEY) {
      headers['x-api-key'] = env.COPILOT_API_KEY
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), GO_EXPLICIT_ABORT_TIMEOUT_MS)
    const response = await fetch(`${SIM_AGENT_API_URL}/api/streams/explicit-abort`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        messageId: streamId,
        userId: authenticatedUserId,
        ...(chatId ? { chatId } : {}),
      }),
    }).finally(() => clearTimeout(timeout))
    if (!response.ok) {
      throw new Error(`Explicit abort marker request failed: ${response.status}`)
    }
  } catch {
    // best effort: local abort should still proceed even if Go marker fails
  }

  const aborted = await abortActiveStream(streamId)
  if (chatId) {
    await waitForPendingChatStream(chatId, GO_EXPLICIT_ABORT_TIMEOUT_MS + 1000, streamId).catch(
      () => false
    )
  }
  return NextResponse.json({ aborted })
}
