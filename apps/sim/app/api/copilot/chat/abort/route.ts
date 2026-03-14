import { NextResponse } from 'next/server'
import { abortActiveStream } from '@/lib/copilot/chat-streaming'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request-helpers'

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

  const aborted = abortActiveStream(streamId)
  return NextResponse.json({ aborted })
}
