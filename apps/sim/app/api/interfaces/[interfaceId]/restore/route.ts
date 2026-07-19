import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { restoreInterfaceContract } from '@/lib/api/contracts/interfaces'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { restoreInterface } from '@/lib/interfaces'
import { interfaceDomainErrorResponse, resolveInterfaceAccess } from '@/app/api/interfaces/utils'

const logger = createLogger('RestoreInterfaceAPI')

/**
 * POST /api/interfaces/[interfaceId]/restore - Un-archives an interface.
 *
 * The only handler that resolves archived rows; the restored record may come
 * back under a suffixed name when the original was reclaimed while archived.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ interfaceId: string }> }) => {
    const requestId = generateRequestId()

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const parsed = await parseRequest(restoreInterfaceContract, request, context)
      if (!parsed.success) return parsed.response

      const { interfaceId } = parsed.data.params

      const access = await resolveInterfaceAccess({
        interfaceId,
        workspaceId: parsed.data.body.workspaceId,
        userId: authResult.userId,
        level: 'write',
        includeArchived: true,
        requestId,
      })
      if (!access.ok) return access.response

      const restored = await restoreInterface(interfaceId)

      logger.info(`[${requestId}] Restored interface ${interfaceId} as "${restored.name}"`)

      recordAudit({
        workspaceId: restored.workspaceId,
        actorId: authResult.userId,
        actorName: authResult.userName ?? undefined,
        actorEmail: authResult.userEmail ?? undefined,
        action: AuditAction.INTERFACE_RESTORED,
        resourceType: AuditResourceType.INTERFACE,
        resourceId: restored.id,
        resourceName: restored.name,
        description: `Restored interface "${restored.name}"`,
        request,
      })

      return NextResponse.json({ success: true, data: restored })
    } catch (error) {
      const mapped = interfaceDomainErrorResponse(error)
      if (mapped) return mapped

      logger.error(`[${requestId}] Failed to restore interface`, error)
      return NextResponse.json({ error: 'Failed to restore interface' }, { status: 500 })
    }
  }
)
