import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { updateWorkspaceFileContentContract } from '@/lib/api/contracts/workspace-files'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performUpdateWorkspaceFileContent } from '@/lib/workspace-files/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFileContentAPI')

/**
 * PUT /api/workspaces/[id]/files/[fileId]/content
 * Update a workspace file's text content (requires write permission)
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateWorkspaceFileContentContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, fileId } = parsed.data.params
    const { content, encoding } = parsed.data.body

    const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (userPermission !== 'admin' && userPermission !== 'write') {
      logger.warn(`User ${session.user.id} lacks write permission for workspace ${workspaceId}`)
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const result = await performUpdateWorkspaceFileContent({
      workspaceId,
      fileId,
      userId: session.user.id,
      content,
      encoding: encoding === 'base64' ? 'base64' : 'utf-8',
      actorName: session.user.name,
      actorEmail: session.user.email,
      request,
    })

    if (!result.success || !result.file) {
      return NextResponse.json(
        {
          success: false,
          error: messageForOrchestrationError(result, 'Failed to update file content'),
        },
        { status: statusForOrchestrationError(result.errorCode) }
      )
    }

    return NextResponse.json({ success: true, file: result.file })
  }
)
