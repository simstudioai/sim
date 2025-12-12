import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('DeleteChatAPI')

const DeleteChatSchema = z.object({
  chatId: z.string(),
})

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = DeleteChatSchema.parse(body)

    // Delete the chat
    await db.delete(copilotChats).where(eq(copilotChats.id, parsed.chatId))

    logger.info('Chat deleted', { chatId: parsed.chatId })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting chat:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete chat' }, { status: 500 })
  }
}
