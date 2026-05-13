import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createMothershipChatContract,
  listMothershipChatsContract,
} from '@/lib/api/contracts/mothership-tasks'
import { parseRequest } from '@/lib/api/server'
import { reconcileChatStreamMarkers } from '@/lib/copilot/chat/stream-liveness'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { taskPubSub } from '@/lib/copilot/tasks'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { assertActiveWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('MothershipChatsAPI')

/**
 * GET /api/mothership/chats?workspaceId=xxx
 * Returns mothership (home) chats for the authenticated user in the given workspace.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const queryResult = await parseRequest(listMothershipChatsContract, request, {})
    if (!queryResult.success) return queryResult.response
    const { workspaceId } = queryResult.data.query

    await assertActiveWorkspaceAccess(workspaceId, userId)

    const chats = await db
      .select({
        id: copilotChats.id,
        title: copilotChats.title,
        updatedAt: copilotChats.updatedAt,
        activeStreamId: copilotChats.conversationId,
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

    const streamMarkers = await reconcileChatStreamMarkers(
      chats.map((c) => ({ chatId: c.id, streamId: c.activeStreamId })),
      { repairVerifiedStaleMarkers: true }
    )
    const reconciled = chats.map((c) => {
      const activeStreamId = streamMarkers.get(c.id)?.streamId ?? null
      return activeStreamId === c.activeStreamId ? c : { ...c, activeStreamId }
    })

    return NextResponse.json({ success: true, data: reconciled })
  } catch (error) {
    logger.error('Error fetching mothership chats:', error)
    return createInternalServerErrorResponse('Failed to fetch chats')
  }
})

/**
 * POST /api/mothership/chats
 * Creates an empty mothership chat and returns its ID.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const validation = await parseRequest(createMothershipChatContract, request, {})
    if (!validation.success) return validation.response
    const { workspaceId } = validation.data.body

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

    captureServerEvent(
      userId,
      'task_created',
      { workspace_id: workspaceId },
      {
        groups: { workspace: workspaceId },
      }
    )

    return NextResponse.json({ success: true, id: chat.id })
  } catch (error) {
    logger.error('Error creating mothership chat:', error)
    return createInternalServerErrorResponse('Failed to create chat')
  }
})
