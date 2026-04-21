import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { getLatestRunForStream } from '@/lib/copilot/async-runs/repository'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request/http'
import { abortActiveStream, waitForPendingChatStream } from '@/lib/copilot/request/session'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotChatAbortAPI')
const GO_EXPLICIT_ABORT_TIMEOUT_MS = 3000
const STREAM_ABORT_SETTLE_TIMEOUT_MS = 8000

export const POST = withRouteHandler(async (request: Request) => {
  const { userId: authenticatedUserId, isAuthenticated } =
    await authenticateCopilotRequestSessionOnly()

  if (!isAuthenticated || !authenticatedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch((err) => {
    logger.warn('Abort request body parse failed; continuing with empty object', {
      error: toError(err).message,
    })
    return {}
  })
  const streamId = typeof body.streamId === 'string' ? body.streamId : ''
  let chatId = typeof body.chatId === 'string' ? body.chatId : ''

  if (!streamId) {
    return NextResponse.json({ error: 'streamId is required' }, { status: 400 })
  }

  if (!chatId) {
    const run = await getLatestRunForStream(streamId, authenticatedUserId).catch((err) => {
      logger.warn('getLatestRunForStream failed while resolving chatId for abort', {
        streamId,
        error: toError(err).message,
      })
      return null
    })
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
    const timeout = setTimeout(
      () => controller.abort('timeout:go_explicit_abort_fetch'),
      GO_EXPLICIT_ABORT_TIMEOUT_MS
    )
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
  } catch (err) {
    logger.warn('Explicit abort marker request failed; proceeding with local abort', {
      streamId,
      error: toError(err).message,
    })
  }

  const aborted = await abortActiveStream(streamId)
  if (chatId) {
    const settled = await waitForPendingChatStream(chatId, STREAM_ABORT_SETTLE_TIMEOUT_MS, streamId)
    if (!settled) {
      return NextResponse.json(
        { error: 'Previous response is still shutting down', aborted, settled: false },
        { status: 409 }
      )
    }
    return NextResponse.json({ aborted, settled: true })
  }

  return NextResponse.json({ aborted })
})
