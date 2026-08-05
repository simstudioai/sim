import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { type NextRequest, NextResponse } from 'next/server'
import { createInterfaceContract, listInterfacesContract } from '@/lib/api/contracts/interfaces'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createInterface, listInterfaces } from '@/lib/interfaces'
import { captureServerEvent } from '@/lib/posthog/server'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { interfaceDomainErrorResponse } from '@/app/api/interfaces/utils'

const logger = createLogger('InterfacesAPI')

/** GET /api/interfaces - Lists the interfaces in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(listInterfacesContract, request, {})
    if (!parsed.success) return parsed.response

    const { workspaceId, scope } = parsed.data.query

    const permission = await getUserEntityPermissions(authResult.userId, 'workspace', workspaceId)
    if (!permissionSatisfies(permission, 'read')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const interfaces = await listInterfaces(workspaceId, { scope })

    logger.info(`[${requestId}] Listed ${interfaces.length} interfaces in workspace ${workspaceId}`)

    return NextResponse.json({ success: true, data: { interfaces } })
  } catch (error) {
    logger.error(`[${requestId}] Failed to list interfaces`, error)
    return NextResponse.json({ error: 'Failed to list interfaces' }, { status: 500 })
  }
})

/** POST /api/interfaces - Creates an interface with an empty layout. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(createInterfaceContract, request, {})
    if (!parsed.success) return parsed.response

    const { body } = parsed.data

    const permission = await getUserEntityPermissions(
      authResult.userId,
      'workspace',
      body.workspaceId
    )
    if (!permissionSatisfies(permission, 'write')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const created = await createInterface({
      workspaceId: body.workspaceId,
      name: body.name,
      description: body.description,
      createdBy: authResult.userId,
    })

    logger.info(`[${requestId}] Created interface ${created.id} in workspace ${body.workspaceId}`)

    captureServerEvent(
      authResult.userId,
      'interface_created',
      { interface_id: created.id, workspace_id: body.workspaceId },
      { groups: { workspace: body.workspaceId } }
    )

    recordAudit({
      workspaceId: body.workspaceId,
      actorId: authResult.userId,
      actorName: authResult.userName ?? undefined,
      actorEmail: authResult.userEmail ?? undefined,
      action: AuditAction.INTERFACE_CREATED,
      resourceType: AuditResourceType.INTERFACE,
      resourceId: created.id,
      resourceName: created.name,
      description: `Created interface "${created.name}"`,
      request,
    })

    return NextResponse.json({ success: true, data: created })
  } catch (error) {
    const mapped = interfaceDomainErrorResponse(error)
    if (mapped) return mapped

    logger.error(`[${requestId}] Failed to create interface`, error)
    return NextResponse.json({ error: 'Failed to create interface' }, { status: 500 })
  }
})
