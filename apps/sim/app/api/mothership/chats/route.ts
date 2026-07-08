import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createMothershipChatContract,
  listMothershipChatsContract,
} from '@/lib/api/contracts/mothership-chats'
import { parseRequest } from '@/lib/api/server'
import { listMothershipChats } from '@/lib/copilot/chat/list-mothership-chats'
import { chatPubSub } from '@/lib/copilot/chat-status'
import {
  authenticateCopilotRequestSessionOnly,
  createForbiddenResponse,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  assertActiveWorkspaceAccess,
  isWorkspaceAccessDeniedError,
} from '@/lib/workspaces/permissions/utils'

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

    const data = await listMothershipChats(userId, workspaceId)

    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (isWorkspaceAccessDeniedError(error)) {
      return createForbiddenResponse('Workspace access denied')
    }
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
        model: 'claude-opus-4-8',
        updatedAt: now,
        lastSeenAt: now,
      })
      .returning({ id: copilotChats.id })

    chatPubSub?.publishStatusChanged({ workspaceId, chatId: chat.id, type: 'created' })

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
    if (isWorkspaceAccessDeniedError(error)) {
      return createForbiddenResponse('Workspace access denied')
    }
    logger.error('Error creating mothership chat:', error)
    return createInternalServerErrorResponse('Failed to create chat')
  }
})
