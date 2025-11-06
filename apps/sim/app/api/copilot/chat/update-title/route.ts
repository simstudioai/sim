/**
 * @deprecated This route is not currently in use
 * @remarks Kept for reference - may be removed in future cleanup
 */

import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UpdateChatTitleAPI')

const UpdateTitleSchema = z.object({
  chatId: z.string(),
  title: z.string(),
})

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = UpdateTitleSchema.parse(body)

    // Update the chat title
    await db
      .update(copilotChats)
      .set({
        title: parsed.title,
        updatedAt: new Date(),
      })
      .where(eq(copilotChats.id, parsed.chatId))

    logger.info('Chat title updated', { chatId: parsed.chatId, title: parsed.title })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error updating chat title:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update chat title' },
      { status: 500 }
    )
  }
}
