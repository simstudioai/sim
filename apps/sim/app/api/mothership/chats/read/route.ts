import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'

const logger = createLogger('MarkTaskReadAPI')

const MarkReadSchema = z.object({
  chatId: z.string().min(1),
})

export async function POST(request: NextRequest) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await request.json()
    const { chatId } = MarkReadSchema.parse(body)

    await db
      .update(copilotChats)
      .set({ lastSeenAt: sql`GREATEST(${copilotChats.updatedAt}, NOW())` })
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createBadRequestResponse('chatId is required')
    }
    logger.error('Error marking task as read:', error)
    return createInternalServerErrorResponse('Failed to mark task as read')
  }
}
