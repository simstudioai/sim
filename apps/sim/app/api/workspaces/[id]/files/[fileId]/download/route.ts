import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { generateRequestId } from '@/lib/utils'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFileDownloadAPI')

/**
 * POST /api/workspaces/[id]/files/[fileId]/download
 * Return authenticated file serve URL (requires read permission)
 * Uses /api/files/serve endpoint which enforces authentication and context
 */
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

    const userPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
    if (!userPermission) {
      logger.warn(
        `[${requestId}] User ${session.user.id} lacks permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const { getBaseUrl } = await import('@/lib/urls/utils')
    const serveUrl = `${getBaseUrl()}/api/files/serve/${encodeURIComponent(fileRecord.key)}?context=workspace`
    const viewerUrl = `${getBaseUrl()}/workspace/${workspaceId}/files/${fileId}/view`

    logger.info(`[${requestId}] Generated download URL for workspace file: ${fileRecord.name}`)

    return NextResponse.json({
      success: true,
      downloadUrl: serveUrl,
      viewerUrl: viewerUrl,
      fileName: fileRecord.name,
      expiresIn: null,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error generating download URL:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate download URL',
      },
      { status: 500 }
    )
  }
}
