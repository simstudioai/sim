import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'
import { taskPubSub } from '@/lib/copilot/task-events'
import { assertActiveWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('MothershipChatsAPI')

/**
 * GET /api/mothership/chats?workspaceId=xxx
 * Returns mothership (home) chats for the authenticated user in the given workspace.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const workspaceId = request.nextUrl.searchParams.get('workspaceId')
    if (!workspaceId) {
      return createBadRequestResponse('workspaceId is required')
    }

    await assertActiveWorkspaceAccess(workspaceId, userId)

    const chats = await db
      .select({
        id: copilotChats.id,
        title: copilotChats.title,
        updatedAt: copilotChats.updatedAt,
        conversationId: copilotChats.conversationId,
        lastSeenAt: copilotChats.lastSeenAt,
      })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.userId, userId),
          eq(copilotChats.workspaceId, workspaceId),
          eq(copilotChats.type, 'mothership')
        )
      )
      .orderBy(desc(copilotChats.updatedAt))

    return NextResponse.json({ success: true, data: chats })
  } catch (error) {
    logger.error('Error fetching mothership chats:', error)
    return createInternalServerErrorResponse('Failed to fetch chats')
  }
}

const CreateChatSchema = z.object({
  workspaceId: z.string().min(1),
})

/**
 * POST /api/mothership/chats
 * Creates an empty mothership chat and returns its ID.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await request.json()
    const { workspaceId } = CreateChatSchema.parse(body)

    await assertActiveWorkspaceAccess(workspaceId, userId)

    const now = new Date()
    const [chat] = await db
      .insert(copilotChats)
      .values({
        userId,
        workspaceId,
        type: 'mothership',
        title: null,
        model: 'claude-opus-4-6',
        messages: [],
        updatedAt: now,
        lastSeenAt: now,
      })
      .returning({ id: copilotChats.id })

    taskPubSub?.publishStatusChanged({ workspaceId, chatId: chat.id, type: 'created' })

    return NextResponse.json({ success: true, id: chat.id })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createBadRequestResponse('workspaceId is required')
    }
    logger.error('Error creating mothership chat:', error)
    return createInternalServerErrorResponse('Failed to create chat')
  }
}
