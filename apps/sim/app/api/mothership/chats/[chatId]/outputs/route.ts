import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { listChatOutputsContract } from '@/lib/api/contracts/mothership-chats'
import { parseRequest } from '@/lib/api/server'
import { getAccessibleCopilotChatAuth } from '@/lib/copilot/chat/lifecycle'
import {
  authenticateCopilotRequestSessionOnly,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { listChatOutputs } from '@/lib/copilot/tools/handlers/output-file-reader'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('MothershipChatOutputsAPI')

/**
 * GET /api/mothership/chats/[chatId]/outputs
 *
 * List the chat-scoped `output` files (agent-generated one-offs) for a chat. These
 * never appear in the workspace Files list (`listWorkspaceFiles` is workspace-only),
 * so the resource panel uses this to show them alongside workspace files in the
 * "+" resource picker and open them as tabs. Returns the same `WorkspaceFileRecord`
 * shape as the workspace file list.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ chatId: string }> }) => {
    try {
      const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
      if (!isAuthenticated || !userId) {
        return createUnauthorizedResponse()
      }

      const parsed = await parseRequest(listChatOutputsContract, request, context)
      if (!parsed.success) return parsed.response
      const { chatId } = parsed.data.params
      const chat = await getAccessibleCopilotChatAuth(chatId, userId)
      if (!chat) {
        return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
      }

      const files = await listChatOutputs(chatId)
      return NextResponse.json({ success: true, files })
    } catch (error) {
      logger.error('Failed to list chat outputs', error)
      return NextResponse.json(
        { success: false, error: getErrorMessage(error, 'Failed to list chat outputs') },
        { status: 500 }
      )
    }
  }
)
