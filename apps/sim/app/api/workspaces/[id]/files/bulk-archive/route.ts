import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { bulkArchiveWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { performDeleteWorkspaceFileItems } from '@/lib/workspace-files/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceFileBulkArchiveAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(bulkArchiveWorkspaceFileItemsContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params
    const { fileIds, folderIds } = parsed.data.body

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (permission !== 'admin' && permission !== 'write') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      const result = await performDeleteWorkspaceFileItems({
        workspaceId,
        userId: session.user.id,
        fileIds,
        folderIds,
      })
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          {
            status:
              result.errorCode === 'validation'
                ? 400
                : result.errorCode === 'not_found'
                  ? 404
                  : 500,
          }
        )
      }
      if (!result.deletedItems) {
        return NextResponse.json(
          { success: false, error: 'Failed to delete workspace file items' },
          { status: 500 }
        )
      }

      captureServerEvent(
        session.user.id,
        'file_bulk_deleted',
        { workspace_id: workspaceId, file_count: fileIds.length, folder_count: folderIds.length },
        { groups: { workspace: workspaceId } }
      )

      return NextResponse.json({ success: true, deletedItems: result.deletedItems })
    } catch (error) {
      logger.error('Failed to bulk archive workspace file items:', error)
      return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
    }
  }
)
