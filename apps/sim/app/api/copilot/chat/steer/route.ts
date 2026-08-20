import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotChatSteerBodySchema } from '@/lib/api/contracts/copilot'
import { validationErrorResponse } from '@/lib/api/server'
import { getLatestRunForStream } from '@/lib/copilot/async-runs/repository'
import { appendCopilotChatMessages } from '@/lib/copilot/chat/messages-store'
import { CopilotSteerOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request/http'
import { withIncomingGoSpan } from '@/lib/copilot/request/otel'
import { requestStreamSteering } from '@/lib/copilot/request/session/steer'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotChatSteerAPI')

// POST /api/copilot/chat/steer — queues a mid-turn steering message with the
// Go side for a LIVE stream. Acceptance means "queued", not "applied": Go
// acknowledges application with a `run`/`steering_applied` stream event; a
// client that never sees that ack before the stream ends re-sends the content
// as an ordinary message. A 409 here tells the client to take that ordinary
// path immediately.
export const POST = withRouteHandler((request: NextRequest) =>
  withIncomingGoSpan(
    request.headers,
    TraceSpan.CopilotChatSteerStream,
    undefined,
    async (rootSpan) => {
      const { userId: authenticatedUserId, isAuthenticated } =
        await authenticateCopilotRequestSessionOnly()
      if (!isAuthenticated || !authenticatedUserId) {
        rootSpan.setAttribute(TraceAttr.CopilotSteerOutcome, CopilotSteerOutcome.BadRequest)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // boundary-raw-json: tolerant parse; validation happens via the contract schema below
      const body = await request.json().catch(() => ({}))
      const validation = copilotChatSteerBodySchema.safeParse(body)
      if (!validation.success) {
        rootSpan.setAttribute(TraceAttr.CopilotSteerOutcome, CopilotSteerOutcome.BadRequest)
        return validationErrorResponse(validation.error, 'Invalid request body')
      }
      const { streamId, chatId, steeringId, content } = validation.data
      rootSpan.setAttributes({
        [TraceAttr.StreamId]: streamId,
        [TraceAttr.ChatId]: chatId,
        [TraceAttr.UserId]: authenticatedUserId,
        [TraceAttr.CopilotSteeringContentChars]: content.length,
      })

      // Ownership pre-check on the Sim side (Go re-proves it independently):
      // the stream must belong to a run of the authenticated user, and the
      // claimed chat must match that run.
      const run = await getLatestRunForStream(streamId, authenticatedUserId).catch((err) => {
        logger.warn('getLatestRunForStream failed while resolving steer context', {
          streamId,
          error: getErrorMessage(err),
        })
        return null
      })
      if (run?.chatId && run.chatId !== chatId) {
        rootSpan.setAttribute(TraceAttr.CopilotSteerOutcome, CopilotSteerOutcome.BadRequest)
        return NextResponse.json({ error: 'Stream does not belong to this chat' }, { status: 403 })
      }

      let queued = false
      let goStatus = 0
      try {
        const result = await requestStreamSteering({
          streamId,
          userId: authenticatedUserId,
          chatId,
          steeringId,
          content,
          workspaceId: run?.workspaceId ?? undefined,
        })
        queued = result.queued
        goStatus = result.status
      } catch (err) {
        logger.warn('Steer forward to Go failed', {
          streamId,
          chatId,
          error: getErrorMessage(err),
        })
      }

      if (!queued) {
        rootSpan.setAttribute(TraceAttr.CopilotSteerOutcome, CopilotSteerOutcome.NoActiveTurn)
        // 409 = "could not queue; send it as an ordinary message instead".
        return NextResponse.json({ ok: false, queued: false, goStatus }, { status: 409 })
      }

      // Persist the steering text as a user message so reloads include it.
      // Failure here must not fail the steer — the message is already queued
      // with Go and will reach the model; persistence is display-only.
      try {
        await appendCopilotChatMessages(
          chatId,
          [
            {
              id: steeringId,
              role: 'user',
              content,
              timestamp: new Date().toISOString(),
            },
          ],
          { streamId }
        )
      } catch (err) {
        logger.warn('Failed to persist steering message to chat history', {
          chatId,
          steeringId,
          error: getErrorMessage(err),
        })
      }

      rootSpan.setAttribute(TraceAttr.CopilotSteerOutcome, CopilotSteerOutcome.Queued)
      logger.info('Queued mid-turn steering message', {
        streamId,
        chatId,
        steeringId,
        contentChars: content.length,
      })
      return NextResponse.json({ ok: true, queued: true })
    }
  )
)
