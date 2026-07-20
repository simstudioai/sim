import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotChatAbortBodySchema } from '@/lib/api/contracts/copilot'
import { validationErrorResponse } from '@/lib/api/server'
import { getLatestRunForStream } from '@/lib/copilot/async-runs/repository'
import { CopilotAbortOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request/http'
import { withCopilotSpan, withIncomingGoSpan } from '@/lib/copilot/request/otel'
import {
  abortActiveStream,
  releasePendingChatStream,
  waitForPendingChatStream,
} from '@/lib/copilot/request/session'
import { requestExplicitStreamAbort } from '@/lib/copilot/request/session/explicit-abort'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotChatAbortAPI')
const GO_EXPLICIT_ABORT_TIMEOUT_MS = 3000
const STREAM_ABORT_SETTLE_TIMEOUT_MS = 8000

// POST /api/copilot/chat/abort — fires on user Stop; marks the Go
// side aborted then waits for the prior stream to settle.
export const POST = withRouteHandler((request: NextRequest) =>
  withIncomingGoSpan(
    request.headers,
    TraceSpan.CopilotChatAbortStream,
    undefined,
    async (rootSpan) => {
      const { userId: authenticatedUserId, isAuthenticated } =
        await authenticateCopilotRequestSessionOnly()

      if (!isAuthenticated || !authenticatedUserId) {
        rootSpan.setAttribute(TraceAttr.CopilotAbortOutcome, CopilotAbortOutcome.Unauthorized)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const body = await request.json().catch((err) => {
        logger.warn('Abort request body parse failed; continuing with empty object', {
          error: getErrorMessage(err),
        })
        return {}
      })
      const validation = copilotChatAbortBodySchema.safeParse(body)
      if (!validation.success) {
        rootSpan.setAttribute(TraceAttr.CopilotAbortOutcome, CopilotAbortOutcome.MissingStreamId)
        return validationErrorResponse(validation.error, 'Invalid request body')
      }
      const { streamId, chatId: parsedChatId } = validation.data
      let chatId = parsedChatId

      if (!streamId) {
        rootSpan.setAttribute(TraceAttr.CopilotAbortOutcome, CopilotAbortOutcome.MissingStreamId)
        return NextResponse.json({ error: 'streamId is required' }, { status: 400 })
      }
      rootSpan.setAttributes({
        [TraceAttr.StreamId]: streamId,
        [TraceAttr.UserId]: authenticatedUserId,
      })

      const run = await getLatestRunForStream(streamId, authenticatedUserId).catch((err) => {
        logger.warn('getLatestRunForStream failed while resolving abort context', {
          streamId,
          error: getErrorMessage(err),
        })
        return null
      })
      if (!chatId && run?.chatId) {
        chatId = run.chatId
      }
      const workspaceId = run?.workspaceId ?? undefined
      if (chatId) rootSpan.setAttribute(TraceAttr.ChatId, chatId)

      const aborted = await abortActiveStream(streamId)
      rootSpan.setAttribute(TraceAttr.CopilotAbortLocalAborted, aborted)

      let goAbortOk = false
      try {
        await requestExplicitStreamAbort({
          streamId,
          userId: authenticatedUserId,
          chatId,
          workspaceId,
          timeoutMs: GO_EXPLICIT_ABORT_TIMEOUT_MS,
        })
        goAbortOk = true
      } catch (err) {
        logger.warn('Explicit abort marker request failed after local abort', {
          streamId,
          error: getErrorMessage(err),
        })
      }
      rootSpan.setAttribute(TraceAttr.CopilotAbortGoMarkerOk, goAbortOk)

      if (chatId) {
        const settled = await withCopilotSpan(
          TraceSpan.CopilotChatAbortWaitSettle,
          {
            [TraceAttr.ChatId]: chatId,
            [TraceAttr.StreamId]: streamId,
            [TraceAttr.SettleTimeoutMs]: STREAM_ABORT_SETTLE_TIMEOUT_MS,
          },
          async (settleSpan) => {
            const start = Date.now()
            const ok = await waitForPendingChatStream(
              chatId,
              STREAM_ABORT_SETTLE_TIMEOUT_MS,
              streamId
            )
            settleSpan.setAttributes({
              [TraceAttr.SettleWaitMs]: Date.now() - start,
              [TraceAttr.SettleCompleted]: ok,
            })
            return ok
          }
        )
        if (!settled) {
          // The holder didn't settle within the grace window even though the
          // user explicitly stopped it and abort markers are written on both
          // sides (local + Go). Don't leave the chat hostage to a wedged
          // handler: break its stream lock. This is safe by construction —
          // releaseLock only deletes when the value still matches this
          // streamId (never clobbers a newer stream), and the old handler's
          // heartbeat uses extendLock-if-owner, so it observes the loss and
          // stops heartbeating rather than re-asserting.
          await releasePendingChatStream(chatId, streamId)
          logger.warn('Stream did not settle after abort; force-released chat stream lock', {
            chatId,
            streamId,
          })
          rootSpan.setAttribute(TraceAttr.CopilotAbortOutcome, CopilotAbortOutcome.ForceReleased)
          return NextResponse.json({ aborted, settled: false, forceReleased: true })
        }
        rootSpan.setAttribute(TraceAttr.CopilotAbortOutcome, CopilotAbortOutcome.Settled)
        return NextResponse.json({ aborted, settled: true })
      }

      rootSpan.setAttribute(TraceAttr.CopilotAbortOutcome, CopilotAbortOutcome.NoChatId)
      return NextResponse.json({ aborted })
    }
  )
)
