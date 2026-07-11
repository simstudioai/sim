import { db } from '@sim/db'
import { folder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { ResourceLockedError } from '@sim/platform-authz/resource-lock'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { restoreFolderContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performRestoreFolder } from '@/lib/folders/orchestration'
import { captureServerEvent } from '@/lib/posthog/server'
import { statusForOrchestrationError } from '@/lib/workflows/orchestration/types'
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

    const [existingFolder] = await db
      .select({ resourceType: folder.resourceType })
      .from(folder)
      .where(and(eq(folder.id, folderId), eq(folder.workspaceId, workspaceId)))
      .limit(1)

    if (!existingFolder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    }

    const result = await performRestoreFolder({
      resourceType: existingFolder.resourceType,
      folderId,
      workspaceId,
      userId: session.user.id,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: statusForOrchestrationError(result.errorCode) }
      )
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
    if (error instanceof ResourceLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    logger.error('Error restoring folder', error)
    return NextResponse.json(
      { error: getErrorMessage(error, 'Internal server error') },
      { status: 500 }
    )
  }
})
