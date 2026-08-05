import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { updateWorkspaceFileDimensionsContract } from '@/lib/api/contracts/workspace-files'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { updateWorkspaceFileDimensions } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceFileDimensionsAPI')

/**
 * PATCH /api/workspaces/[id]/files/[fileId]/dimensions
 *
 * Backfill an image file's intrinsic pixel dimensions — a pure rendering hint the editor uses to reserve
 * layout space before the image loads. Requires write permission and is idempotent (a no-op once the
 * dimensions are already stored), so the client can fire it once per image without coordination.
 */
export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateWorkspaceFileDimensionsContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, fileId } = parsed.data.params
    const { key, width, height } = parsed.data.body

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (permission !== 'admin' && permission !== 'write') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      await updateWorkspaceFileDimensions(workspaceId, fileId, { key, width, height })
      return NextResponse.json({ success: true as const })
    } catch (error) {
      logger.error('Failed to backfill workspace file dimensions', {
        workspaceId,
        fileId,
        error: getErrorMessage(error),
      })
      return NextResponse.json({ error: 'Failed to update dimensions' }, { status: 500 })
    }
  }
)
