import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { registerWorkspaceFileContract } from '@/lib/api/contracts/workspace-files'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  FileConflictError,
  parseWorkspaceFileKey,
  registerUploadedWorkspaceFile,
} from '@/lib/uploads/contexts/workspace'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceRegisterAPI')

/**
 * POST /api/workspaces/[id]/files/register
 * Finalize a direct-to-storage upload by inserting metadata, updating quota,
 * and recording an audit log. Validates the storage key belongs to the
 * caller's workspace to prevent cross-tenant key smuggling.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const parsed = await parseRequest(registerWorkspaceFileContract, request, context)
    if (!parsed.success) return parsed.response
    const { params, body } = parsed.data
    const workspaceId = params.id
    const { key, name, contentType, folderId } = body

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (permission !== 'admin' && permission !== 'write') {
      logger.warn(`User ${userId} lacks write permission for ${workspaceId}`)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (parseWorkspaceFileKey(key) !== workspaceId) {
      logger.warn(`Key ${key} does not belong to workspace ${workspaceId}`)
      return NextResponse.json(
        { error: 'Storage key does not belong to this workspace' },
        { status: 400 }
      )
    }

    try {
      const { file: userFile, created } = await registerUploadedWorkspaceFile({
        workspaceId,
        userId,
        key,
        originalName: name,
        contentType,
        folderId,
      })

      if (created) {
        logger.info(`Registered direct upload ${name} -> ${key}`)

        captureServerEvent(
          userId,
          'file_uploaded',
          { workspace_id: workspaceId, file_type: contentType },
          { groups: { workspace: workspaceId } }
        )

        recordAudit({
          workspaceId,
          actorId: userId,
          actorName: session.user.name,
          actorEmail: session.user.email,
          action: AuditAction.FILE_UPLOADED,
          resourceType: AuditResourceType.FILE,
          resourceId: userFile.id,
          resourceName: name,
          description: `Uploaded file "${name}"`,
          metadata: { fileSize: userFile.size, fileType: contentType },
          request,
        })
      } else {
        logger.info(`Idempotent re-register for existing upload ${name} -> ${key}`)
      }

      return NextResponse.json({ success: true, file: userFile })
    } catch (error) {
      logger.error('Failed to register workspace file:', error)

      const errorMessage = error instanceof Error ? error.message : 'Failed to register file'
      const isDuplicate =
        error instanceof FileConflictError || errorMessage.includes('already exists')
      const isMissing = errorMessage.includes('not found in storage')

      const status = isDuplicate ? 409 : isMissing ? 404 : 500
      return NextResponse.json({ success: false, error: errorMessage, isDuplicate }, { status })
    }
  }
)
