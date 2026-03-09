import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { updateWorkspaceFileContent } from '@/lib/uploads/contexts/workspace'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFileContentAPI')

/**
 * PUT /api/workspaces/[id]/files/[fileId]/content
 * Update a workspace file's text content (requires write permission)
 */
export async function PUT(
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
      logger.warn(
        `[${requestId}] User ${session.user.id} lacks write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const { content } = body as { content: string }

    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'Content must be a string' }, { status: 400 })
    }

    const buffer = Buffer.from(content, 'utf-8')
    const updatedFile = await updateWorkspaceFileContent(
      workspaceId,
      fileId,
      session.user.id,
      buffer
    )

    logger.info(`[${requestId}] Updated content for workspace file: ${updatedFile.name}`)

    recordAudit({
      workspaceId,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.FILE_UPDATED,
      resourceType: AuditResourceType.FILE,
      resourceId: fileId,
      description: `Updated content of file "${updatedFile.name}"`,
      request,
    })

    return NextResponse.json({
      success: true,
      file: updatedFile,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error updating file content:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update file content',
      },
      { status: 500 }
    )
  }
}
