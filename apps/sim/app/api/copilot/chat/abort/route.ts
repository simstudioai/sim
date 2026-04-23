import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
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

      // Local abort before Go — lets the lifecycle classifier see
      // `signal.aborted` with an explicit-stop reason before Go's
      // context-canceled error propagates back. Go's endpoint runs
      // second for billing-ledger flush; Go's context is already
      // cancelled by then.
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
)
