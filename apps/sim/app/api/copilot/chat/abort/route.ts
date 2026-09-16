import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotChatAbortBodySchema } from '@/lib/api/contracts/copilot'
import { validationErrorResponse } from '@/lib/api/server'
import { getLatestRunForStream } from '@/lib/copilot/async-runs/repository'
import { getAccessibleCopilotChatAuth } from '@/lib/copilot/chat/lifecycle'
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
      const {
        userId: authenticatedUserId,
        isAuthenticated,
        principal,
      } = await authenticateCopilotRequestSessionOnly()

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
      if (!run || (chatId && chatId !== run.chatId)) {
        return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
      }
      const chat = run.chatId
        ? await getAccessibleCopilotChatAuth(run.chatId, authenticatedUserId, { principal })
        : null
      if (run.chatId && !chat) {
        return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
      }
      if (!chatId && run?.chatId) {
        chatId = run.chatId
      }
      const workspaceId = run?.workspaceId ?? undefined
      if (chatId) rootSpan.setAttribute(TraceAttr.ChatId, chatId)

      // ORDER IS LOAD-BEARING: Go's abort marker must be durable BEFORE
      // anything tears down the SSE.
      //
      // `abortActiveStream` is what triggers that teardown — directly when
      // this box holds the stream, otherwise via the Redis marker its 250ms
      // poller picks up on the box that does. The moment Go sees the socket
      // close it decides "user stop vs. client disconnect" by consuming its
      // own marker, once, with no retry. Writing that marker second lost the
      // race on ~84% of stops: Go read an absent marker, filed a deliberate
      // Stop as an unexpected termination, and persisted the turn's orphaned
      // tool calls with a synthetic `provider_error` result that the
      // assistant then read back and reported to the user as a vendor outage.
      //
      // The reorder costs the Go round-trip (~400ms median) before generation
      // actually stops. Perceived stop latency is unchanged — the client marks
      // the turn stopped optimistically before this request is even sent — and
      // the added wait is bounded by the timeout below, leaving the settle
      // wait that follows well inside the client's own 15s budget.
      let goAbortOk = false
      try {
        await requestExplicitStreamAbort({
          streamId,
          userId: authenticatedUserId,
          chatId,
          workspaceId,
          ...(chat?.organizationId ? { organizationId: chat.organizationId } : {}),
          timeoutMs: GO_EXPLICIT_ABORT_TIMEOUT_MS,
        })
        goAbortOk = true
      } catch (err) {
        // Never let a failed or slow marker write block the user's Stop — fall
        // through and abort locally regardless. Go re-checks the marker when
        // its stream goroutine exits, so a write that lands late still
        // classifies correctly.
        logger.warn('Explicit abort marker request failed; aborting locally anyway', {
          streamId,
          error: getErrorMessage(err),
        })
      }
      rootSpan.setAttribute(TraceAttr.CopilotAbortGoMarkerOk, goAbortOk)

      const aborted = await abortActiveStream(streamId)
      rootSpan.setAttribute(TraceAttr.CopilotAbortLocalAborted, aborted)

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
