import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { listWorkspaceFiles, uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { generateRequestId } from '@/lib/utils'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFilesAPI')

/**
 * GET /api/workspaces/[id]/files
 * List all files for a workspace (requires read permission)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id: workspaceId } = await params

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

    const files = await listWorkspaceFiles(workspaceId)

    logger.info(`[${requestId}] Listed ${files.length} files for workspace ${workspaceId}`)

    return NextResponse.json({
      success: true,
      files,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error listing workspace files:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list files',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/workspaces/[id]/files
 * Upload a new file to workspace storage (requires write permission)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id: workspaceId } = await params

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

    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file size (100MB limit)
    const maxSize = 100 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `File size exceeds 100MB limit (${(file.size / (1024 * 1024)).toFixed(2)}MB)` },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    const userFile = await uploadWorkspaceFile(
      workspaceId,
      session.user.id,
      buffer,
      file.name,
      file.type || 'application/octet-stream'
    )

    logger.info(`[${requestId}] Uploaded workspace file: ${file.name}`)

    return NextResponse.json({
      success: true,
      file: userFile,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error uploading workspace file:`, error)

    // Check if it's a duplicate file error
    const errorMessage = error instanceof Error ? error.message : 'Failed to upload file'
    const isDuplicate = errorMessage.includes('already exists')

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        isDuplicate,
      },
      { status: isDuplicate ? 409 : 500 }
    )
  }
}
