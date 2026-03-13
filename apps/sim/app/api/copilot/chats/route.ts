import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'
import { getActiveWorkflowRecord } from '@/lib/workflows/active-context'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CopilotChatsListAPI')

export async function GET(_request: NextRequest) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const chats = await db
      .select({
        id: copilotChats.id,
        title: copilotChats.title,
        workflowId: copilotChats.workflowId,
        workspaceId: copilotChats.workspaceId,
        updatedAt: copilotChats.updatedAt,
      })
      .from(copilotChats)
      .where(eq(copilotChats.userId, userId))
      .orderBy(desc(copilotChats.updatedAt))

    const visibleChats = (
      await Promise.all(
        chats.map(async (chat) => {
          if (chat.workflowId) {
            const workflow = await getActiveWorkflowRecord(chat.workflowId)
            return workflow ? chat : null
          }
          const workspaceId = (chat as { workspaceId?: string | null }).workspaceId
          if (workspaceId) {
            const access = await checkWorkspaceAccess(workspaceId, userId)
            return access.exists && access.hasAccess ? chat : null
          }
          return chat
        })
      )
    ).filter((chat): chat is (typeof chats)[number] => chat !== null)

    logger.info(`Retrieved ${visibleChats.length} chats for user ${userId}`)

    return NextResponse.json({ success: true, chats: visibleChats })
  } catch (error) {
    logger.error('Error fetching user copilot chats:', error)
    return createInternalServerErrorResponse('Failed to fetch user chats')
  }
}
