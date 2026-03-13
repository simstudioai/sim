import { db } from '@sim/db'
import { copilotChats, permissions, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
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

    const visibleChats = await db
      .selectDistinctOn([copilotChats.id], {
        id: copilotChats.id,
        title: copilotChats.title,
        workflowId: copilotChats.workflowId,
        workspaceId: copilotChats.workspaceId,
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
