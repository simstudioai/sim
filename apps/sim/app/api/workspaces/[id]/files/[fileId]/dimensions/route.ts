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
 * Store an image file's intrinsic pixel dimensions — a pure rendering hint the editor uses to reserve
 * layout space before the image loads. Requires write permission. The write commits whenever the row
 * still holds the measured storage key, overwriting any stale value so a wrong size self-corrects; the
 * client reports only on a real mismatch, so this is not storm-y despite not being a backfill-once no-op.
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
      // `written` is false when the content-version guard rejected the write (the row's storage key no
      // longer matches the key the client measured — the content was replaced since). That is not an
      // error; the client's next measurement, once its file list has the new key, persists correctly.
      const written = await updateWorkspaceFileDimensions(workspaceId, fileId, {
        key,
        width,
        height,
      })
      return NextResponse.json({ success: written })
    } catch (error) {
      logger.error('Failed to store workspace file dimensions', {
        workspaceId,
        fileId,
        error: getErrorMessage(error),
      })
      return NextResponse.json({ error: 'Failed to update dimensions' }, { status: 500 })
    }
  }
)
