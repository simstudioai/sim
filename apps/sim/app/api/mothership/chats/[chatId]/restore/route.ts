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

const logger = createLogger('RestoreMothershipChatAPI')

/**
 * POST /api/mothership/chats/[chatId]/restore
 * Restores a soft-deleted mothership chat back into the sidebar. Ownership is
 * enforced by scoping the update to the authenticated user's rows, and the
 * caller must still have access to the chat's workspace, matching the delete
 * path.
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

      const [chat] = await db
        .select({ workspaceId: copilotChats.workspaceId })
        .from(copilotChats)
        .where(
          and(
            eq(copilotChats.id, chatId),
            eq(copilotChats.userId, userId),
            eq(copilotChats.type, 'mothership'),
            isNotNull(copilotChats.deletedAt)
          )
        )
        .limit(1)

      if (!chat) {
        return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
      }
      if (chat.workspaceId) {
        await assertActiveWorkspaceAccess(chat.workspaceId, userId)
      }

      // Bump `updatedAt` (like workflow/table/KB restores) so the restored chat
      // surfaces at the top of the sidebar, and mark it seen for the restorer.
      const now = new Date()
      const [restoredChat] = await db
        .update(copilotChats)
        .set({ deletedAt: null, updatedAt: now, lastSeenAt: now })
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
      if (isWorkspaceAccessDeniedError(error)) {
        return createForbiddenResponse('Workspace access denied')
      }
      logger.error('Error restoring mothership chat:', error)
      return createInternalServerErrorResponse('Failed to restore chat')
    }
  }
)
