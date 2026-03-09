import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'

const logger = createLogger('CopilotChatsListAPI')

export async function GET(_request: NextRequest) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const chats = await db
      .select({
        id: copilotChats.id,
        title: copilotChats.title,
        workflowId: copilotChats.workflowId,
        updatedAt: copilotChats.updatedAt,
      })
      .from(copilotChats)
      .where(eq(copilotChats.userId, userId))
      .orderBy(desc(copilotChats.updatedAt))

    logger.info(`Retrieved ${chats.length} chats for user ${userId}`)

    return NextResponse.json({ success: true, chats })
  } catch (error) {
    logger.error('Error fetching user copilot chats:', error)
    return createInternalServerErrorResponse('Failed to fetch user chats')
  }
}
