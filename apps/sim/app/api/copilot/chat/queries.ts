import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getAccessibleCopilotChat } from '@/lib/copilot/chat/lifecycle'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import { assertActiveWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CopilotChatAPI')

function transformChat(chat: {
  id: string
  title: string | null
  model: string | null
  messages: unknown
  planArtifact?: unknown
  config?: unknown
  conversationId?: string | null
  resources?: unknown
  createdAt: Date | null
  updatedAt: Date | null
}) {
  return {
    id: chat.id,
    title: chat.title,
    model: chat.model,
    messages: Array.isArray(chat.messages) ? chat.messages : [],
    messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
    planArtifact: chat.planArtifact || null,
    config: chat.config || null,
    ...('conversationId' in chat ? { activeStreamId: chat.conversationId || null } : {}),
    ...('resources' in chat
      ? { resources: Array.isArray(chat.resources) ? chat.resources : [] }
      : {}),
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const workflowId = searchParams.get('workflowId')
    const workspaceId = searchParams.get('workspaceId')
    const chatId = searchParams.get('chatId')

    const { userId: authenticatedUserId, isAuthenticated } =
      await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !authenticatedUserId) {
      return createUnauthorizedResponse()
    }

    if (chatId) {
      const chat = await getAccessibleCopilotChat(chatId, authenticatedUserId)
      if (!chat) {
        return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
      }

      logger.info(`Retrieved chat ${chatId}`)
      return NextResponse.json({ success: true, chat: transformChat(chat) })
    }

    if (!workflowId && !workspaceId) {
      return createBadRequestResponse('workflowId, workspaceId, or chatId is required')
    }

    if (workspaceId) {
      await assertActiveWorkspaceAccess(workspaceId, authenticatedUserId)
    }

    if (workflowId) {
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: authenticatedUserId,
        action: 'read',
      })
      if (!authorization.allowed) {
        return createUnauthorizedResponse()
      }
    }

    const scopeFilter = workflowId
      ? eq(copilotChats.workflowId, workflowId)
      : eq(copilotChats.workspaceId, workspaceId!)

    const chats = await db
      .select({
        id: copilotChats.id,
        title: copilotChats.title,
        model: copilotChats.model,
        messages: copilotChats.messages,
        planArtifact: copilotChats.planArtifact,
        config: copilotChats.config,
        createdAt: copilotChats.createdAt,
        updatedAt: copilotChats.updatedAt,
      })
      .from(copilotChats)
      .where(and(eq(copilotChats.userId, authenticatedUserId), scopeFilter))
      .orderBy(desc(copilotChats.updatedAt))

    const scope = workflowId ? `workflow ${workflowId}` : `workspace ${workspaceId}`
    logger.info(`Retrieved ${chats.length} chats for ${scope}`)

    return NextResponse.json({
      success: true,
      chats: chats.map(transformChat),
    })
  } catch (error) {
    logger.error('Error fetching copilot chats:', error)
    return createInternalServerErrorResponse('Failed to fetch chats')
  }
}
