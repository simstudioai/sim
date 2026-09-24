import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotChatStopContract } from '@/lib/api/contracts/copilot'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAccessibleCopilotChatAuth } from '@/lib/mothership/chat/lifecycle'
import {
  normalizeMessage,
  type PersistedMessage,
  withStoppedContentBlock,
} from '@/lib/mothership/chat/persisted-message'
import {
  finalizeAssistantTurn,
  readStoppedAssistantMessage,
} from '@/lib/mothership/chat/terminal-state'
import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import {
  CopilotChatFinalizeOutcome,
  CopilotStopOutcome,
} from '@/lib/mothership/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { withIncomingGoSpan } from '@/lib/mothership/request/otel'

const logger = createLogger('CopilotChatStopAPI')

// POST /api/copilot/chat/stop — persists partial assistant content
// when the user stops mid-stream. Lock release is handled by the
// aborted server stream unwinding, not this handler.
export const POST = withRouteHandler((req: NextRequest) =>
  withIncomingGoSpan(req.headers, TraceSpan.CopilotChatStopStream, undefined, async (span) => {
    try {
      const session = await getSession()
      if (!session?.user?.id) {
        span.setAttribute(TraceAttr.CopilotStopOutcome, CopilotStopOutcome.Unauthorized)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(copilotChatStopContract, req, {})
      if (!parsed.success) {
        span.setAttribute(TraceAttr.CopilotStopOutcome, CopilotStopOutcome.ValidationError)
        return parsed.response
      }
      const { chatId, streamId, content, contentBlocks, requestId } = parsed.data.body
      const chat = await getAccessibleCopilotChatAuth(chatId, session.user.id, {
        principal: { kind: 'session', userId: session.user.id, sessionId: session.session.id },
      })
      if (!chat) return NextResponse.json({ success: true })
      span.setAttributes({
        [TraceAttr.ChatId]: chatId,
        [TraceAttr.StreamId]: streamId,
        [TraceAttr.UserId]: session.user.id,
        [TraceAttr.CopilotStopContentLength]: content.length,
        [TraceAttr.CopilotStopBlocksCount]: contentBlocks?.length ?? 0,
        ...(requestId ? { [TraceAttr.RequestId]: requestId } : {}),
      })

      const hasContent = content.trim().length > 0
      const hasBlocks = Array.isArray(contentBlocks) && contentBlocks.length > 0
      const assistantBlocks = hasBlocks
        ? contentBlocks
        : hasContent
          ? [{ type: 'text', channel: 'assistant', content }]
          : []
      const assistantMessage: PersistedMessage | null =
        hasContent || hasBlocks
          ? withStoppedContentBlock(
              normalizeMessage({
                id: generateId(),
                role: 'assistant',
                content,
                timestamp: new Date().toISOString(),
                contentBlocks: assistantBlocks,
                ...(requestId ? { requestId } : {}),
              })
            )
          : await readStoppedAssistantMessage(streamId)
      /** The run owner retains the full response if replay was trimmed or has not started. */
      if (!assistantMessage) return NextResponse.json({ success: true })
      const result = await finalizeAssistantTurn({
        chatId,
        userId: session.user.id,
        userMessageId: streamId,
        assistantMessage,
        streamMarkerPolicy: 'active-or-cleared',
        preferServerReplay: hasContent || hasBlocks,
      })
      span.setAttribute(TraceAttr.CopilotStopAppendedAssistant, result.appendedAssistant)
      const stopOutcome = !result.found
        ? CopilotStopOutcome.ChatNotFound
        : result.updated || result.outcome === CopilotChatFinalizeOutcome.AssistantAlreadyPersisted
          ? CopilotStopOutcome.Persisted
          : CopilotStopOutcome.NoMatchingRow
      const shouldPublishCompleted =
        result.updated || result.outcome === CopilotChatFinalizeOutcome.AssistantAlreadyPersisted

      if (shouldPublishCompleted) {
        publishChatStatusChanged(chat, {
          chatId,
          type: 'completed',
          streamId,
        })
      }

      span.setAttribute(TraceAttr.CopilotStopOutcome, stopOutcome)
      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error stopping chat stream:', error)
      span.setAttribute(TraceAttr.CopilotStopOutcome, CopilotStopOutcome.InternalError)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  })
)
