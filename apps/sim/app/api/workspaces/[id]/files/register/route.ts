import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
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

interface RegisterRequestBody {
  key: string
  name: string
  size: number
  contentType: string
}

/**
 * POST /api/workspaces/[id]/files/register
 * Finalize a direct-to-storage upload by inserting metadata, updating quota,
 * and recording an audit log. Validates the storage key belongs to the
 * caller's workspace to prevent cross-tenant key smuggling.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: workspaceId } = await params

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (permission !== 'admin' && permission !== 'write') {
      logger.warn(`User ${userId} lacks write permission for ${workspaceId}`)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let body: RegisterRequestBody
    try {
      body = (await request.json()) as RegisterRequestBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { key, name, size, contentType } = body
    if (!key?.trim()) {
      return NextResponse.json({ error: 'key is required' }, { status: 400 })
    }
    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
      return NextResponse.json({ error: 'size must be a non-negative number' }, { status: 400 })
    }
    if (!contentType?.trim()) {
      return NextResponse.json({ error: 'contentType is required' }, { status: 400 })
    }

    if (parseWorkspaceFileKey(key) !== workspaceId) {
      logger.warn(`Key ${key} does not belong to workspace ${workspaceId}`)
      return NextResponse.json(
        { error: 'Storage key does not belong to this workspace' },
        { status: 400 }
      )
    }

    try {
      const userFile = await registerUploadedWorkspaceFile({
        workspaceId,
        userId,
        key,
        originalName: name,
        contentType,
        size,
      })

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
        metadata: { fileSize: size, fileType: contentType },
        request,
      })

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
