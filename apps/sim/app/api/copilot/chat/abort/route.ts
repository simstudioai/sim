import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getLatestRunForStream } from '@/lib/copilot/async-runs/repository'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { CopilotAbortOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request/http'
import { withCopilotSpan, withIncomingGoSpan } from '@/lib/copilot/request/otel'
import { abortActiveStream, waitForPendingChatStream } from '@/lib/copilot/request/session'
import { env } from '@/lib/core/config/env'

const logger = createLogger('CopilotChatAbortAPI')
const GO_EXPLICIT_ABORT_TIMEOUT_MS = 3000
const STREAM_ABORT_SETTLE_TIMEOUT_MS = 8000

/**
 * POST /api/copilot/chat/abort
 *
 * Hang-critical: the client calls this when the user hits "stop". It
 * fans out to Go (explicit-abort marker) and then waits up to
 * STREAM_ABORT_SETTLE_TIMEOUT_MS (8s) for the prior chat stream to
 * unwind. If EITHER the Go fetch or the settle-wait hangs, the user
 * sees a "still shutting down" 409 — or worse, an unresolved Promise
 * on the client. The spans below pinpoint which phase stalled.
 */
export async function POST(request: Request) {
  return withIncomingGoSpan(
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
          error: err instanceof Error ? err.message : String(err),
        })
        return {}
      })
      const streamId = typeof body.streamId === 'string' ? body.streamId : ''
      let chatId = typeof body.chatId === 'string' ? body.chatId : ''

      if (!streamId) {
        rootSpan.setAttribute(TraceAttr.CopilotAbortOutcome, CopilotAbortOutcome.MissingStreamId)
        return NextResponse.json({ error: 'streamId is required' }, { status: 400 })
      }
      rootSpan.setAttributes({
        [TraceAttr.StreamId]: streamId,
        [TraceAttr.UserId]: authenticatedUserId,
      })

      if (!chatId) {
        const run = await getLatestRunForStream(streamId, authenticatedUserId).catch((err) => {
          logger.warn('getLatestRunForStream failed while resolving chatId for abort', {
            streamId,
            error: err instanceof Error ? err.message : String(err),
          })
          return null
        })
        if (run?.chatId) {
          chatId = run.chatId
        }
      }
      if (chatId) rootSpan.setAttribute(TraceAttr.ChatId, chatId)

      // ORDER MATTERS: local abort FIRST, Go explicit-abort SECOND.
      //
      // Sim and Go each own a separate Redis instance and do not share
      // state through it — the only signal that crosses the service
      // boundary is this HTTP call. So the race to win is purely
      // Sim-internal:
      //
      //   - `abortActiveStream` flips the AbortController (reason =
      //     AbortReason.UserStop) that's wrapped around the in-flight
      //     `fetchGo('/api/mothership', ...)` SSE stream. Once flipped,
      //     the stream throws AbortError on the next chunk read, and
      //     the lifecycle catch block's classifier sees
      //     `signal.aborted = true` with an explicit-stop reason → the
      //     root span gets stamped `cancel_reason = explicit_stop` and
      //     the `request.cancelled` event fires correctly.
      //
      //   - If we call Go first (old order), Go's context cancels from
      //     its own explicit-abort handler, the /api/mothership stream
      //     errors with "context canceled", and Sim's catch block fires
      //     BEFORE we've flipped the local AbortController. At that
      //     point `signal.aborted` is still false, so the classifier
      //     falls through to `client_disconnect` / `unknown` and the
      //     root ends up as `outcome = error` — which is what we saw
      //     in trace 25f31730082078cef54653b1740caf12.
      //
      // Go's explicit-abort endpoint still runs second: it's what tells
      // Go-side billing "this was intentional, flush the paused ledger"
      // and is unaffected by the reorder (Go's context is already
      // cancelled by the time we get there; the endpoint's job is
      // billing semantics, not cancelling in-flight work).
      const aborted = await abortActiveStream(streamId)
      rootSpan.setAttribute(TraceAttr.CopilotAbortLocalAborted, aborted)

      let goAbortOk = false
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
        const response = await fetchGo(`${SIM_AGENT_API_URL}/api/streams/explicit-abort`, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            messageId: streamId,
            userId: authenticatedUserId,
            ...(chatId ? { chatId } : {}),
          }),
          spanName: 'sim → go /api/streams/explicit-abort',
          operation: 'explicit_abort',
          attributes: {
            [TraceAttr.StreamId]: streamId,
            ...(chatId ? { [TraceAttr.ChatId]: chatId } : {}),
          },
        }).finally(() => clearTimeout(timeout))
        if (!response.ok) {
          throw new Error(`Explicit abort marker request failed: ${response.status}`)
        }
        goAbortOk = true
      } catch (err) {
        logger.warn('Explicit abort marker request failed after local abort', {
          streamId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      rootSpan.setAttribute(TraceAttr.CopilotAbortGoMarkerOk, goAbortOk)

      if (chatId) {
        // `waitForPendingChatStream` blocks up to 8s waiting for the
        // prior stream's release. It's THE single most likely stall
        // point in this handler — isolate it so a slow unwind shows up
        // as this child span rather than unexplained root latency.
        const settled = await withCopilotSpan(
          TraceSpan.CopilotChatAbortWaitSettle,
          {
            'chat.id': chatId,
            'stream.id': streamId,
            'settle.timeout_ms': STREAM_ABORT_SETTLE_TIMEOUT_MS,
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
          rootSpan.setAttribute(TraceAttr.CopilotAbortOutcome, CopilotAbortOutcome.SettleTimeout)
          return NextResponse.json(
            { error: 'Previous response is still shutting down', aborted, settled: false },
            { status: 409 }
          )
        }
        rootSpan.setAttribute(TraceAttr.CopilotAbortOutcome, CopilotAbortOutcome.Settled)
        return NextResponse.json({ aborted, settled: true })
      }

      rootSpan.setAttribute(TraceAttr.CopilotAbortOutcome, CopilotAbortOutcome.NoChatId)
      return NextResponse.json({ aborted })
    }
  )
}
