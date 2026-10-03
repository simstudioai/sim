import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createMothershipChatContract,
  listMothershipChatsContract,
} from '@/lib/api/contracts/mothership-chats'
import { parseRequest } from '@/lib/api/server'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  ChatWorkspaceAccessError,
  listWorkspaceChats,
} from '@/lib/mothership/chat/application/use-cases'
import {
  createOrganizationChat,
  listOrganizationChats,
} from '@/lib/mothership/chat/organization-chats'
import { chatPubSub } from '@/lib/mothership/chat-status'
import { MOTHERSHIP_CHAT_DEFAULT_MODEL } from '@/lib/mothership/constants'
import {
  authenticateCopilotRequestSessionOnly,
  createForbiddenResponse,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/mothership/request/http'
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
    const { userId, isAuthenticated, principal } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const queryResult = await parseRequest(listMothershipChatsContract, request, {})
    if (!queryResult.success) return queryResult.response
    const { workspaceId, organizationId, scope } = queryResult.data.query

    if (organizationId) {
      if (!principal) return createUnauthorizedResponse()
      const data = await listOrganizationChats.execute({
        principal,
        input: { organizationId, scope },
      })
      return NextResponse.json({ success: true, data })
    }

    if (!workspaceId) throw new Error('Conversation owner is required')
    if (!principal) return createUnauthorizedResponse()
    const data = await listWorkspaceChats.execute({ principal, input: { workspaceId, scope } })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof ChatWorkspaceAccessError)
      return createForbiddenResponse('Workspace access denied')
    const code = asOrchestrationError(error)?.code
    if (code === 'not_found' || code === 'forbidden')
      return createForbiddenResponse('Organization access denied')
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
    const { userId, isAuthenticated, principal } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const validation = await parseRequest(createMothershipChatContract, request, {})
    if (!validation.success) return validation.response
    const { workspaceId, organizationId, mode } = validation.data.body

    if (organizationId) {
      if (!principal) return createUnauthorizedResponse()
      const chat = await createOrganizationChat.execute({
        principal,
        input: { organizationId, mode },
      })
      return NextResponse.json({ success: true, id: chat.id })
    }

    if (!workspaceId) throw new Error('Conversation owner is required')
    await assertActiveWorkspaceAccess(workspaceId, userId)

    const now = new Date()
    const [chat] = await db
      .insert(copilotChats)
      .values({
        userId,
        workspaceId,
        type: 'mothership',
        title: null,
        model: MOTHERSHIP_CHAT_DEFAULT_MODEL,
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
    const code = asOrchestrationError(error)?.code
    if (code === 'not_found' || code === 'forbidden')
      return createForbiddenResponse('Organization access denied')
    if (isWorkspaceAccessDeniedError(error)) {
      return createForbiddenResponse('Workspace access denied')
    }
    logger.error('Error creating mothership chat:', error)
    return createInternalServerErrorResponse('Failed to create chat')
  }
})
