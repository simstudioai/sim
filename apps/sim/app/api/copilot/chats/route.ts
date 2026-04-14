import { db } from '@sim/db'
import { copilotChats, permissions, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveOrCreateChat } from '@/lib/copilot/chat/lifecycle'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { taskPubSub } from '@/lib/copilot/tasks'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import { assertActiveWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CopilotChatsListAPI')

const CreateWorkflowCopilotChatSchema = z.object({
  workspaceId: z.string().min(1),
  workflowId: z.string().min(1),
})

const DEFAULT_COPILOT_MODEL = 'claude-opus-4-6'

export async function GET(_request: NextRequest) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const visibleChats = await db
      .selectDistinctOn([copilotChats.id], {
        id: copilotChats.id,
        title: copilotChats.title,
        workflowId: copilotChats.workflowId,
        workspaceId: copilotChats.workspaceId,
        activeStreamId: copilotChats.conversationId,
        updatedAt: copilotChats.updatedAt,
      })
      .from(copilotChats)
      .leftJoin(workflow, eq(copilotChats.workflowId, workflow.id))
      .leftJoin(
        workspace,
        or(
          eq(workflow.workspaceId, workspace.id),
          and(isNull(copilotChats.workflowId), eq(copilotChats.workspaceId, workspace.id))
        )
      )
      .leftJoin(
        permissions,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspace.id),
          eq(permissions.userId, userId)
        )
      )
      .where(
        and(
          eq(copilotChats.userId, userId),
          or(
            and(isNull(copilotChats.workflowId), isNull(copilotChats.workspaceId)),
            sql`${permissions.id} IS NOT NULL`
          ),
          or(isNull(workflow.id), isNull(workflow.archivedAt)),
          or(isNull(workspace.id), isNull(workspace.archivedAt))
        )
      )
      .orderBy(copilotChats.id, desc(copilotChats.updatedAt))

    const sorted = [...visibleChats].sort(
      (a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime()
    )

    logger.info(`Retrieved ${sorted.length} chats for user ${userId}`)

    return NextResponse.json({ success: true, chats: sorted })
  } catch (error) {
    logger.error('Error fetching user copilot chats:', error)
    return createInternalServerErrorResponse('Failed to fetch user chats')
  }
}

/**
 * POST /api/copilot/chats
 * Creates an empty workflow-scoped copilot chat (same lifecycle as {@link resolveOrCreateChat}).
 * Matches mothership's POST /api/mothership/chats pattern so the client always selects a real row id.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await request.json()
    const { workspaceId, workflowId } = CreateWorkflowCopilotChatSchema.parse(body)

    await assertActiveWorkspaceAccess(workspaceId, userId)

    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId,
      action: 'read',
    })
    if (!authorization.allowed || !authorization.workflow) {
      return NextResponse.json(
        { success: false, error: authorization.message ?? 'Forbidden' },
        { status: authorization.status }
      )
    }

    if (authorization.workflow.workspaceId !== workspaceId) {
      return createBadRequestResponse('workflow does not belong to this workspace')
    }

    const result = await resolveOrCreateChat({
      userId,
      workflowId,
      workspaceId,
      model: DEFAULT_COPILOT_MODEL,
      type: 'copilot',
    })

    if (!result.chatId) {
      return createInternalServerErrorResponse('Failed to create chat')
    }

    taskPubSub?.publishStatusChanged({ workspaceId, chatId: result.chatId, type: 'created' })

    return NextResponse.json({ success: true, id: result.chatId })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createBadRequestResponse('workspaceId and workflowId are required')
    }
    logger.error('Error creating workflow copilot chat:', error)
    return createInternalServerErrorResponse('Failed to create chat')
  }
}
