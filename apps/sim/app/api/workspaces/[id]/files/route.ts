import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  FileConflictError,
  listWorkspaceFiles,
  uploadWorkspaceFile,
  type WorkspaceFileScope,
} from '@/lib/uploads/contexts/workspace'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFilesAPI')

/**
 * GET /api/workspaces/[id]/files
 * List all files for a workspace (requires read permission)
 */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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

      const scope = (new URL(request.url).searchParams.get('scope') ??
        'active') as WorkspaceFileScope
      if (!['active', 'archived', 'all'].includes(scope)) {
        return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
      }

      const files = await listWorkspaceFiles(workspaceId, { scope })

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
)

/**
 * POST /api/workspaces/[id]/files
 * Upload a new file to workspace storage (requires write permission)
 */
export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id: workspaceId } = await params

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Check workspace permissions (requires write)
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workspaceId
      )
      if (userPermission !== 'admin' && userPermission !== 'write') {
        logger.warn(
          `[${requestId}] User ${session.user.id} lacks write permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      const formData = await request.formData()
      const rawFile = formData.get('file')

      if (!rawFile || !(rawFile instanceof File)) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 })
      }

      const fileName = rawFile.name || 'untitled.md'

      const maxSize = 100 * 1024 * 1024
      if (rawFile.size > maxSize) {
        return NextResponse.json(
          {
            error: `File size exceeds 100MB limit (${(rawFile.size / (1024 * 1024)).toFixed(2)}MB)`,
          },
          { status: 400 }
        )
      }

      const buffer = Buffer.from(await rawFile.arrayBuffer())

      const userFile = await uploadWorkspaceFile(
        workspaceId,
        session.user.id,
        buffer,
        fileName,
        rawFile.type || 'application/octet-stream'
      )

      logger.info(`[${requestId}] Uploaded workspace file: ${fileName}`)

      captureServerEvent(
        session.user.id,
        'file_uploaded',
        { workspace_id: workspaceId, file_type: rawFile.type || 'application/octet-stream' },
        { groups: { workspace: workspaceId } }
      )

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.FILE_UPLOADED,
        resourceType: AuditResourceType.FILE,
        resourceId: userFile.id,
        resourceName: fileName,
        description: `Uploaded file "${fileName}"`,
        metadata: { fileSize: rawFile.size, fileType: rawFile.type || 'application/octet-stream' },
        request,
      })

      return NextResponse.json({
        success: true,
        file: userFile,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error uploading workspace file:`, error)

      const errorMessage = error instanceof Error ? error.message : 'Failed to upload file'
      const isDuplicate =
        error instanceof FileConflictError || errorMessage.includes('already exists')

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
)
