import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { restoreWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreWorkspaceFileAPI')

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const requestId = generateRequestId()
  const { id: workspaceId, fileId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (userPermission !== 'admin' && userPermission !== 'write') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    await restoreWorkspaceFile(workspaceId, fileId)

    logger.info(`[${requestId}] Restored workspace file ${fileId}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error restoring workspace file ${fileId}`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
