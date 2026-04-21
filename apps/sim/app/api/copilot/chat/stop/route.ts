import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { normalizeMessage, type PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import { taskPubSub } from '@/lib/copilot/tasks'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotChatStopAPI')

const StoredToolCallSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    state: z.string().optional(),
    params: z.record(z.unknown()).optional(),
    result: z
      .object({
        success: z.boolean(),
        output: z.unknown().optional(),
        error: z.string().optional(),
      })
      .optional(),
    display: z
      .object({
        text: z.string().optional(),
        title: z.string().optional(),
        phaseLabel: z.string().optional(),
      })
      .optional(),
    calledBy: z.string().optional(),
    durationMs: z.number().optional(),
    error: z.string().optional(),
  })
  .nullable()

const ContentBlockSchema = z.object({
  type: z.string(),
  lane: z.enum(['main', 'subagent']).optional(),
  content: z.string().optional(),
  channel: z.enum(['assistant', 'thinking']).optional(),
  phase: z.enum(['call', 'args_delta', 'result']).optional(),
  kind: z.enum(['subagent', 'structured_result', 'subagent_result']).optional(),
  lifecycle: z.enum(['start', 'end']).optional(),
  status: z.enum(['complete', 'error', 'cancelled']).optional(),
  toolCall: StoredToolCallSchema.optional(),
})

const StopSchema = z.object({
  chatId: z.string(),
  streamId: z.string(),
  content: z.string(),
  contentBlocks: z.array(ContentBlockSchema).optional(),
})

/**
 * POST /api/copilot/chat/stop
 * Persists partial assistant content when the user stops a stream mid-response.
 * Clears conversationId so the server-side onComplete won't duplicate the message.
 * The chat stream lock is intentionally left alone here; it is released only once
 * the aborted server stream actually unwinds.
 */
export const POST = withRouteHandler(async (req: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { chatId, streamId, content, contentBlocks } = StopSchema.parse(await req.json())
    const [row] = await db
      .select({
        workspaceId: copilotChats.workspaceId,
        messages: copilotChats.messages,
      })
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, session.user.id)))
      .limit(1)

    if (!row) {
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
      })
      const assistantMessage: PersistedMessage = normalized
      setClause.messages = sql`${copilotChats.messages} || ${JSON.stringify([assistantMessage])}::jsonb`
    }

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
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    logger.error('Error stopping chat stream:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
