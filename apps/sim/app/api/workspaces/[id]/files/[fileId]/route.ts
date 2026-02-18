import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { deleteWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFileAPI')

/**
 * DELETE /api/workspaces/[id]/files/[fileId]
 * Delete a workspace file (requires write permission)
 */
export async function DELETE(
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

    // Check workspace permissions (requires write)
    const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (userPermission !== 'admin' && userPermission !== 'write') {
      logger.warn(
        `[${requestId}] User ${session.user.id} lacks write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    await deleteWorkspaceFile(workspaceId, fileId)

    logger.info(`[${requestId}] Deleted workspace file: ${fileId}`)

    recordAudit({
      workspaceId,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: 'file.deleted',
      resourceType: 'file',
      resourceId: fileId,
      description: `Deleted file "${fileId}"`,
      request,
    })

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting workspace file:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete file',
      },
      { status: 500 }
    )
  }
}
