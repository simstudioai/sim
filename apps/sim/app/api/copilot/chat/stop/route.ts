import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotChatStopContract } from '@/lib/api/contracts/copilot'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { normalizeMessage, type PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import { CopilotStopOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { withIncomingGoSpan } from '@/lib/copilot/request/otel'
import { taskPubSub } from '@/lib/copilot/tasks'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

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
      span.setAttributes({
        [TraceAttr.ChatId]: chatId,
        [TraceAttr.StreamId]: streamId,
        [TraceAttr.UserId]: session.user.id,
        [TraceAttr.CopilotStopContentLength]: content.length,
        [TraceAttr.CopilotStopBlocksCount]: contentBlocks?.length ?? 0,
        ...(requestId ? { [TraceAttr.RequestId]: requestId } : {}),
      })

      const [row] = await db
        .select({
          workspaceId: copilotChats.workspaceId,
          messages: copilotChats.messages,
        })
        .from(copilotChats)
        .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, session.user.id)))
        .limit(1)

      if (!row) {
        span.setAttribute(TraceAttr.CopilotStopOutcome, CopilotStopOutcome.ChatNotFound)
        return NextResponse.json({ success: true })
      }

      const messages: Record<string, unknown>[] = Array.isArray(row.messages) ? row.messages : []
      const userIdx = messages.findIndex((message) => message.id === streamId)
      const alreadyHasResponse =
        userIdx >= 0 &&
        userIdx + 1 < messages.length &&
        (messages[userIdx + 1] as Record<string, unknown>)?.role === 'assistant'
      const canAppendAssistant =
        userIdx >= 0 && userIdx === messages.length - 1 && !alreadyHasResponse

      const updateWhere = and(
        eq(copilotChats.id, chatId),
        eq(copilotChats.userId, session.user.id),
        eq(copilotChats.conversationId, streamId)
      )

      const setClause: Record<string, unknown> = {
        conversationId: null,
        updatedAt: new Date(),
      }

      const hasContent = content.trim().length > 0
      const hasBlocks = Array.isArray(contentBlocks) && contentBlocks.length > 0
      const synthesizedStoppedBlocks = hasBlocks
        ? contentBlocks
        : hasContent
          ? [{ type: 'text', channel: 'assistant', content }, { type: 'stopped' }]
          : [{ type: 'stopped' }]
      if (canAppendAssistant) {
        const normalized = normalizeMessage({
          id: generateId(),
          role: 'assistant',
          content,
          timestamp: new Date().toISOString(),
          contentBlocks: synthesizedStoppedBlocks,
          // Persist so the UI copy-request-id button survives refetch.
          ...(requestId ? { requestId } : {}),
        })
        const assistantMessage: PersistedMessage = normalized
        setClause.messages = sql`${copilotChats.messages} || ${JSON.stringify([assistantMessage])}::jsonb`
      }
      span.setAttribute(TraceAttr.CopilotStopAppendedAssistant, canAppendAssistant)

      const [updated] = await db
        .update(copilotChats)
        .set(setClause)
        .where(updateWhere)
        .returning({ workspaceId: copilotChats.workspaceId })

      if (updated?.workspaceId) {
        taskPubSub?.publishStatusChanged({
          workspaceId: updated.workspaceId,
          chatId,
          type: 'completed',
          streamId,
        })
      }

      span.setAttribute(
        TraceAttr.CopilotStopOutcome,
        updated ? CopilotStopOutcome.Persisted : CopilotStopOutcome.NoMatchingRow
      )
      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error stopping chat stream:', error)
      span.setAttribute(TraceAttr.CopilotStopOutcome, CopilotStopOutcome.InternalError)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  })
)
