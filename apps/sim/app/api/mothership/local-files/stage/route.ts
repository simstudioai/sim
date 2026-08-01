import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { stageLocalFileUploadContract } from '@/lib/api/contracts/mothership-chats'
import { parseRequest } from '@/lib/api/server'
import { getAccessibleCopilotChatAuth } from '@/lib/copilot/chat/lifecycle'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { encodeVfsSegment } from '@/lib/copilot/vfs/path-utils'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { trackChatUpload } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('StageLocalFileUploadAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const parsed = await parseRequest(stageLocalFileUploadContract, request, {})
    if (!parsed.success) return parsed.response
    const { workspaceId, chatId, key } = parsed.data.body

    const [chat, permission] = await Promise.all([
      getAccessibleCopilotChatAuth(chatId, userId),
      getUserEntityPermissions(userId, 'workspace', workspaceId),
    ])
    if (!chat || chat.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }
    if (permission !== 'write' && permission !== 'admin') {
      return NextResponse.json(
        { error: 'Write or Admin access required for chat uploads' },
        { status: 403 }
      )
    }

    const [file] = await db
      .select({
        chatId: workspaceFiles.chatId,
        displayName: workspaceFiles.displayName,
        originalName: workspaceFiles.originalName,
        contentType: workspaceFiles.contentType,
        size: workspaceFiles.size,
      })
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.key, key),
          eq(workspaceFiles.userId, userId),
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.context, 'mothership'),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .limit(1)

    if (!file) {
      return NextResponse.json({ error: 'Uploaded file not found' }, { status: 404 })
    }
    if (file.chatId && file.chatId !== chatId) {
      return NextResponse.json(
        { error: 'Uploaded file is already linked to another chat' },
        { status: 409 }
      )
    }

    const displayName =
      file.chatId === chatId && file.displayName
        ? file.displayName
        : (
            await trackChatUpload(
              workspaceId,
              userId,
              chatId,
              key,
              file.originalName,
              file.contentType,
              file.size
            )
          ).displayName

    return NextResponse.json({
      success: true,
      displayName,
      fileName: displayName,
      uploadPath: `uploads/${encodeVfsSegment(displayName)}`,
    })
  } catch (error) {
    logger.error('Failed to stage local file upload', error)
    return createInternalServerErrorResponse('Failed to stage local file upload')
  }
})
