import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  getInterfaceShareContract,
  upsertInterfaceShareContract,
} from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getShareForResource,
  ShareValidationError,
  upsertResourceShare,
} from '@/lib/public-shares/share-manager'
import { resolveInterfaceAccess } from '@/app/api/interfaces/utils'
import {
  PublicInterfaceSharingNotAllowedError,
  validatePublicInterfaceSharing,
} from '@/ee/access-control/utils/permission-check'

export const dynamic = 'force-dynamic'

const logger = createLogger('InterfaceShareAPI')

interface InterfaceShareRouteParams {
  params: Promise<{ interfaceId: string }>
}

/**
 * GET /api/interfaces/[interfaceId]/share
 * Fetch the public share state for an interface (requires workspace read access).
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: InterfaceShareRouteParams) => {
    const requestId = generateRequestId()

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(getInterfaceShareContract, request, context)
      if (!parsed.success) return parsed.response
      const { interfaceId } = parsed.data.params

      const access = await resolveInterfaceAccess({
        interfaceId,
        workspaceId: parsed.data.query.workspaceId,
        userId: session.user.id,
        level: 'read',
        requestId,
      })
      if (!access.ok) return access.response

      const share = await getShareForResource('interface', interfaceId)
      return NextResponse.json({ share })
    } catch (error) {
      logger.error(`[${requestId}] Error fetching interface share:`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to fetch share') },
        { status: 500 }
      )
    }
  }
)

/**
 * PUT /api/interfaces/[interfaceId]/share
 * Enable or disable the public share for an interface (requires write permission).
 *
 * The share row survives archiving so a restore brings the same link back; every
 * public path still 404s while the interface is archived.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: InterfaceShareRouteParams) => {
    const requestId = generateRequestId()

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(upsertInterfaceShareContract, request, context)
      if (!parsed.success) return parsed.response
      const { interfaceId } = parsed.data.params
      const { workspaceId, isActive, authType, password, allowedEmails, token } = parsed.data.body

      const access = await resolveInterfaceAccess({
        interfaceId,
        workspaceId,
        userId: session.user.id,
        level: 'write',
        requestId,
      })
      if (!access.ok) return access.response

      const { definition } = access

      // Enabling a share is gated by the org's access-control policy (both the
      // master on/off and the per-auth-type allow-list); disabling is always
      // allowed so users can still un-share after the policy is turned on.
      if (isActive) {
        try {
          await validatePublicInterfaceSharing(
            session.user.id,
            definition.workspaceId,
            authType ?? 'public'
          )
        } catch (error) {
          if (error instanceof PublicInterfaceSharingNotAllowedError) {
            logger.warn(
              `[${requestId}] Public interface sharing disabled for workspace ${definition.workspaceId}`
            )
            return NextResponse.json({ error: error.message }, { status: 403 })
          }
          throw error
        }
      }

      const share = await upsertResourceShare({
        resourceType: 'interface',
        resourceId: interfaceId,
        workspaceId: definition.workspaceId,
        userId: session.user.id,
        isActive,
        authType,
        password,
        allowedEmails,
        token,
      })

      logger.info(
        `[${requestId}] ${isActive ? 'Enabled' : 'Disabled'} share for interface ${interfaceId}`
      )

      recordAudit({
        workspaceId: definition.workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: isActive ? AuditAction.INTERFACE_SHARED : AuditAction.INTERFACE_SHARE_DISABLED,
        resourceType: AuditResourceType.INTERFACE,
        resourceId: interfaceId,
        resourceName: definition.name,
        description: `${isActive ? 'Enabled' : 'Disabled'} public share for "${definition.name}"`,
        request,
      })

      return NextResponse.json({ share })
    } catch (error) {
      if (error instanceof ShareValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      logger.error(`[${requestId}] Error updating interface share:`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to update share') },
        { status: 500 }
      )
    }
  }
)
