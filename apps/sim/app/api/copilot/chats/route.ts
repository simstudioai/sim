import { db } from '@sim/db'
import { copilotChats, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { reconcileChatStreamMarkers } from '@/lib/mothership/chat/stream-liveness'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/mothership/request/http'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

const logger = createLogger('CopilotChatsListAPI')

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
          isNull(copilotChats.deletedAt),
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
