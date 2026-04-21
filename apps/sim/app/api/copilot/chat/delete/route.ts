import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getAccessibleCopilotChat } from '@/lib/copilot/chat/lifecycle'
import { taskPubSub } from '@/lib/copilot/tasks'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('DeleteChatAPI')

const DeleteChatSchema = z.object({
  chatId: z.string(),
})

export const DELETE = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = DeleteChatSchema.parse(body)

    const chat = await getAccessibleCopilotChat(parsed.chatId, session.user.id)
    if (!chat) {
      return NextResponse.json({ success: true })
    }

    const [deleted] = await db
      .delete(copilotChats)
      .where(and(eq(copilotChats.id, parsed.chatId), eq(copilotChats.userId, session.user.id)))
      .returning({ workspaceId: copilotChats.workspaceId })

    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
    }

    logger.info('Chat deleted', { chatId: parsed.chatId })

    if (deleted.workspaceId) {
      taskPubSub?.publishStatusChanged({
        workspaceId: deleted.workspaceId,
        chatId: parsed.chatId,
        type: 'deleted',
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting chat:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete chat' }, { status: 500 })
  }
})
