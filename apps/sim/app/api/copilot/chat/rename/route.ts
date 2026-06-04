import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { renameCopilotChatContract } from '@/lib/api/contracts/copilot'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getAccessibleCopilotChatAuth } from '@/lib/copilot/chat/lifecycle'
import { taskPubSub } from '@/lib/copilot/tasks'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('RenameChatAPI')

export const PATCH = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(
      renameCopilotChatContract,
      request,
      {},
      {
        validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request data'),
      }
    )
    if (!parsed.success) return parsed.response
    const { chatId, title } = parsed.data.body

    const chat = await getAccessibleCopilotChatAuth(chatId, session.user.id)
    if (!chat) {
      return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
    }

    const now = new Date()
    const [updated] = await db
      .update(copilotChats)
      .set({ title, updatedAt: now, lastSeenAt: now })
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, session.user.id)))
      .returning({ id: copilotChats.id, workspaceId: copilotChats.workspaceId })

    if (!updated) {
      return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
    }

    logger.info('Chat renamed', { chatId, title })

    if (updated.workspaceId) {
      taskPubSub?.publishStatusChanged({
        workspaceId: updated.workspaceId,
        chatId,
        type: 'renamed',
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error renaming chat:', error)
    return NextResponse.json({ success: false, error: 'Failed to rename chat' }, { status: 500 })
  }
})
