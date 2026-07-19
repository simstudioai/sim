import { db } from '@sim/db'
import { copilotChats, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createWorkflowCopilotChatContract } from '@/lib/api/contracts/copilot'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { resolveOrCreateChat } from '@/lib/copilot/chat/lifecycle'
import { reconcileChatStreamMarkers } from '@/lib/copilot/chat/stream-liveness'
import { chatPubSub } from '@/lib/copilot/chat-status'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createForbiddenResponse,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  assertActiveWorkspaceAccess,
  isWorkspaceAccessDeniedError,
} from '@/lib/workspaces/permissions/utils'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

const logger = createLogger('CopilotChatsListAPI')

const DEFAULT_COPILOT_MODEL = 'claude-opus-4-6'

export const GET = withRouteHandler(async (_request: NextRequest) => {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    // Active accessible workspaces (explicit + org-derived). Using the active
    // scope keeps the archived-workspace exclusion the old join-based query had.
    const accessibleRows = await listAccessibleWorkspaceRowsForUser(userId)
    const accessibleWorkspaceIds = accessibleRows.map((row) => row.workspace.id)
    const inAccessibleWorkspace =
      accessibleWorkspaceIds.length > 0
        ? or(
            inArray(workflow.workspaceId, accessibleWorkspaceIds),
            and(
              isNull(copilotChats.workflowId),
              inArray(copilotChats.workspaceId, accessibleWorkspaceIds)
            )
          )
        : undefined

    const visibleChats = await db
      .selectDistinctOn([copilotChats.id], {
        id: copilotChats.id,
        title: copilotChats.title,
        workflowId: copilotChats.workflowId,
        workspaceId: copilotChats.workspaceId,
        activeStreamId: copilotChats.conversationId,
        updatedAt: copilotChats.updatedAt,
        lastSeenAt: copilotChats.lastSeenAt,
      })
      .from(copilotChats)
      .leftJoin(workflow, eq(copilotChats.workflowId, workflow.id))
      .where(
        and(
          eq(copilotChats.userId, userId),
          or(
            and(isNull(copilotChats.workflowId), isNull(copilotChats.workspaceId)),
            inAccessibleWorkspace
          ),
          or(isNull(workflow.id), isNull(workflow.archivedAt))
        )
      )
      .orderBy(copilotChats.id, desc(copilotChats.updatedAt))

    const sorted = [...visibleChats].sort(
      (a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime()
    )

    // Verify live-stream markers so `activeStreamId` means "actually
    // streaming", not a stale marker from a crashed run — same reconciliation
    // the mothership sidebar list applies.
    const streamMarkers = await reconcileChatStreamMarkers(
      sorted.map((c) => ({ chatId: c.id, streamId: c.activeStreamId })),
      { repairVerifiedStaleMarkers: true }
    )
    const chats = sorted.map((c) => ({
      ...c,
      activeStreamId: streamMarkers.get(c.id)?.streamId ?? null,
    }))

    logger.info(`Retrieved ${chats.length} chats for user ${userId}`)

    return NextResponse.json({ success: true, chats })
  } catch (error) {
    logger.error('Error fetching user copilot chats:', error)
    return createInternalServerErrorResponse('Failed to fetch user chats')
  }
})

/**
 * POST /api/copilot/chats
 * Creates an empty workflow-scoped copilot chat (same lifecycle as {@link resolveOrCreateChat}).
 * Matches mothership's POST /api/mothership/chats pattern so the client always selects a real row id.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const parsed = await parseRequest(
      createWorkflowCopilotChatContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          validationErrorResponse(error, 'workspaceId and workflowId are required'),
      }
    )
    if (!parsed.success) return parsed.response
    const { workspaceId, workflowId } = parsed.data.body

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

    chatPubSub?.publishStatusChanged({ workspaceId, chatId: result.chatId, type: 'created' })

    return NextResponse.json({ success: true, id: result.chatId })
  } catch (error) {
    if (isWorkspaceAccessDeniedError(error)) {
      return createForbiddenResponse('Workspace access denied')
    }
    logger.error('Error creating workflow copilot chat:', error)
    return createInternalServerErrorResponse('Failed to create chat')
  }
})
