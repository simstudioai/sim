import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNotNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { restoreMothershipChatContract } from '@/lib/api/contracts/mothership-chats'
import { parseRequest } from '@/lib/api/server'
import { chatPubSub } from '@/lib/copilot/chat-status'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('RestoreMothershipChatAPI')

/**
 * POST /api/mothership/chats/[chatId]/restore
 * Restores a soft-deleted mothership chat back into the sidebar. Ownership is
 * enforced by scoping the update to the authenticated user's rows, matching
 * the delete path.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ chatId: string }> }) => {
    try {
      const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
      if (!isAuthenticated || !userId) {
        return createUnauthorizedResponse()
      }

      const parsed = await parseRequest(restoreMothershipChatContract, request, context)
      if (!parsed.success) return parsed.response
      const { chatId } = parsed.data.params

      const [restoredChat] = await db
        .update(copilotChats)
        .set({ deletedAt: null })
        .where(
          and(
            eq(copilotChats.id, chatId),
            eq(copilotChats.userId, userId),
            eq(copilotChats.type, 'mothership'),
            isNotNull(copilotChats.deletedAt)
          )
        )
        .returning({
          workspaceId: copilotChats.workspaceId,
        })

      if (!restoredChat) {
        return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
      }

      if (restoredChat.workspaceId) {
        chatPubSub?.publishStatusChanged({
          workspaceId: restoredChat.workspaceId,
          chatId,
          type: 'created',
        })
        captureServerEvent(
          userId,
          'task_restored',
          { workspace_id: restoredChat.workspaceId },
          {
            groups: { workspace: restoredChat.workspaceId },
          }
        )
      }

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error restoring mothership chat:', error)
      return createInternalServerErrorResponse('Failed to restore chat')
    }
  }
)
