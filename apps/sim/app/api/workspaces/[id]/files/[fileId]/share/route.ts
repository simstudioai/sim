import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { getFileShareContract, upsertFileShareContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getShareForResource,
  ShareValidationError,
  upsertFileShare,
} from '@/lib/public-shares/share-manager'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import {
  PublicFileSharingNotAllowedError,
  validatePublicFileSharing,
} from '@/ee/access-control/utils/permission-check'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFileShareAPI')

/**
 * GET /api/workspaces/[id]/files/[fileId]/share
 * Fetch the public share state for a file (requires workspace membership).
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const requestId = generateRequestId()

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(getFileShareContract, request, context)
      if (!parsed.success) return parsed.response
      const { id: workspaceId, fileId } = parsed.data.params

      const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
      if (permission === null) {
        logger.warn(
          `[${requestId}] User ${session.user.id} lacks access to workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      const file = await getWorkspaceFile(workspaceId, fileId)
      if (!file) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      const share = await getShareForResource('file', fileId)
      return NextResponse.json({ share })
    } catch (error) {
      logger.error(`[${requestId}] Error fetching file share:`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to fetch share') },
        {
          status: 500,
        }
      )
    }
  }
)

/**
 * PUT /api/workspaces/[id]/files/[fileId]/share
 * Enable or disable the public share for a file (requires write permission).
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const requestId = generateRequestId()

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(upsertFileShareContract, request, context)
      if (!parsed.success) return parsed.response
      const { id: workspaceId, fileId } = parsed.data.params
      const { isActive, authType, password, allowedEmails, token } = parsed.data.body

      const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
      if (permission !== 'admin' && permission !== 'write') {
        logger.warn(
          `[${requestId}] User ${session.user.id} lacks write permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      const file = await getWorkspaceFile(workspaceId, fileId)
      if (!file) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      // Enabling a share is gated by the org's access-control policy (both the
      // master on/off and the per-auth-type allow-list); disabling is always
      // allowed so users can still un-share after the policy is turned on.
      if (isActive) {
        try {
          await validatePublicFileSharing(session.user.id, workspaceId, authType ?? 'public')
        } catch (error) {
          if (error instanceof PublicFileSharingNotAllowedError) {
            logger.warn(`[${requestId}] Public file sharing disabled for workspace ${workspaceId}`)
            return NextResponse.json({ error: error.message }, { status: 403 })
          }
          throw error
        }
      }

      const share = await upsertFileShare({
        workspaceId,
        fileId,
        userId: session.user.id,
        isActive,
        authType,
        password,
        allowedEmails,
        token,
      })

      logger.info(`[${requestId}] ${isActive ? 'Enabled' : 'Disabled'} share for file ${fileId}`)

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: isActive ? AuditAction.FILE_SHARED : AuditAction.FILE_SHARE_DISABLED,
        resourceType: AuditResourceType.FILE,
        resourceId: fileId,
        resourceName: file.name,
        description: `${isActive ? 'Enabled' : 'Disabled'} public share for "${file.name}"`,
        request,
      })

      return NextResponse.json({ share })
    } catch (error) {
      if (error instanceof ShareValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      logger.error(`[${requestId}] Error updating file share:`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to update share') },
        {
          status: 500,
        }
      )
    }
  }
)
