import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { restoreFolderContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { performRestoreFolder } from '@/lib/workflows/orchestration/folder-lifecycle'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreFolderAPI')

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(restoreFolderContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: folderId } = parsed.data.params
    const { workspaceId } = parsed.data.body

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (permission !== 'admin' && permission !== 'write') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const result = await performRestoreFolder({
      folderId,
      workspaceId,
      userId: session.user.id,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    logger.info(`Restored folder ${folderId}`, { restoredItems: result.restoredItems })

    captureServerEvent(
      session.user.id,
      'folder_restored',
      { folder_id: folderId, workspace_id: workspaceId },
      { groups: { workspace: workspaceId } }
    )

    return NextResponse.json({ success: true, restoredItems: result.restoredItems })
  } catch (error) {
    logger.error('Error restoring folder', error)
    return NextResponse.json(
      { error: getErrorMessage(error, 'Internal server error') },
      { status: 500 }
    )
  }
})
