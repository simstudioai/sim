import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { captureServerEvent } from '@/lib/posthog/server'
import { performRestoreFolder } from '@/lib/workflows/orchestration/folder-lifecycle'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreFolderAPI')

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: folderId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const workspaceId = body.workspaceId as string | undefined

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 })
    }

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
    logger.error(`Error restoring folder ${folderId}`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
