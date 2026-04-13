import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getAccessibleCopilotChat } from '@/lib/copilot/chat/lifecycle'
import { taskPubSub } from '@/lib/copilot/tasks'

const logger = createLogger('RenameChatAPI')

const RenameChatSchema = z.object({
  chatId: z.string().min(1),
  title: z.string().min(1).max(200),
})

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { chatId, title } = RenameChatSchema.parse(body)

    const chat = await getAccessibleCopilotChat(chatId, session.user.id)
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    logger.error('Error renaming chat:', error)
    return NextResponse.json({ success: false, error: 'Failed to rename chat' }, { status: 500 })
  }
}
