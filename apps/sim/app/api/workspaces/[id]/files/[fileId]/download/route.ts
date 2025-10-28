import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { StorageService } from '@/lib/uploads'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { generateRequestId } from '@/lib/utils'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFileDownloadAPI')

/**
 * POST /api/workspaces/[id]/files/[fileId]/download
 * Generate presigned download URL (requires read permission)
 * Reuses execution file helper pattern for 5-minute presigned URLs
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

    // Check workspace permissions (requires read)
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

    // Generate 5-minute presigned URL using unified storage service
    const downloadUrl = await StorageService.generatePresignedDownloadUrl(
      fileRecord.key,
      'workspace',
      5 * 60 // 5 minutes
    )

    logger.info(`[${requestId}] Generated download URL for workspace file: ${fileRecord.name}`)

    return NextResponse.json({
      success: true,
      downloadUrl,
      fileName: fileRecord.name,
      expiresIn: 300, // 5 minutes
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
