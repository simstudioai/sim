import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteInterfaceContract,
  getInterfaceContract,
  updateInterfaceContract,
} from '@/lib/api/contracts/interfaces'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  deleteInterface,
  type InterfaceDefinition,
  renameInterface,
  updateInterfaceDescription,
  updateInterfaceLayout,
  validateLayout,
} from '@/lib/interfaces'
import { captureServerEvent } from '@/lib/posthog/server'
import { interfaceDomainErrorResponse, resolveInterfaceAccess } from '@/app/api/interfaces/utils'

const logger = createLogger('InterfaceDetailAPI')

interface InterfaceRouteParams {
  params: Promise<{ interfaceId: string }>
}

/** GET /api/interfaces/[interfaceId] - Retrieves a single interface. */
export const GET = withRouteHandler(async (request: NextRequest, context: InterfaceRouteParams) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(getInterfaceContract, request, context)
    if (!parsed.success) return parsed.response

    const access = await resolveInterfaceAccess({
      interfaceId: parsed.data.params.interfaceId,
      workspaceId: parsed.data.query.workspaceId,
      userId: authResult.userId,
      level: 'read',
      requestId,
    })
    if (!access.ok) return access.response

    return NextResponse.json({ success: true, data: access.definition })
  } catch (error) {
    logger.error(`[${requestId}] Failed to get interface`, error)
    return NextResponse.json({ error: 'Failed to get interface' }, { status: 500 })
  }
})

/**
 * PATCH /api/interfaces/[interfaceId] - Updates an interface's name,
 * description, and/or layout.
 *
 * The three fields map to three service writers, applied in that order; the
 * last result is returned so the response always reflects every applied change.
 * `description` is tri-state — omitted leaves it untouched, `null` clears it.
 *
 * The order is deliberate: `renameInterface` is the only writer that can
 * conflict (409), so it runs before anything else is committed, and the layout
 * — the only writer with semantic validation — is pre-checked when it shares
 * the request with another field, so a rejection cannot leave a rename
 * committed behind a 400 with no audit entry.
 *
 * `expectedUpdatedAt` is an optional optimistic-concurrency precondition on the
 * layout write: when the stored row has moved on since the caller read it, the
 * service throws and this returns 409 with nothing committed.
 */
export const PATCH = withRouteHandler(
  async (request: NextRequest, context: InterfaceRouteParams) => {
    const requestId = generateRequestId()

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const parsed = await parseRequest(updateInterfaceContract, request, context)
      if (!parsed.success) return parsed.response

      const { interfaceId } = parsed.data.params
      const { body } = parsed.data

      const access = await resolveInterfaceAccess({
        interfaceId,
        workspaceId: body.workspaceId,
        userId: authResult.userId,
        level: 'write',
        requestId,
      })
      if (!access.ok) return access.response

      /**
       * The writers below are independent statements, not one transaction. A
       * layout-only PATCH (the editor's autosave) needs no pre-check —
       * `updateInterfaceLayout` validates it and nothing has been committed
       * when it throws — but once another field shares the request, a late
       * layout rejection would strand that field's write. Validating up front
       * in that case keeps the sequence all-or-nothing without paying the
       * reference lookups twice on the hot path.
       */
      const writeCount = [body.name, body.description, body.layout].filter(
        (value) => value !== undefined
      ).length
      if (body.layout !== undefined && writeCount > 1) {
        await validateLayout(access.definition.workspaceId, body.layout)
      }

      let result: InterfaceDefinition = access.definition
      if (body.name !== undefined) {
        result = await renameInterface(interfaceId, body.name)
      }
      if (body.description !== undefined) {
        result = await updateInterfaceDescription(interfaceId, body.description)
      }
      if (body.layout !== undefined) {
        /**
         * The precondition exists to detect *other* writers, so it is dropped
         * once a writer earlier in this same request has already bumped
         * `updatedAt` — a combined name/description + layout PATCH would
         * otherwise 409 against its own rename.
         */
        const precededByOwnWrite = body.name !== undefined || body.description !== undefined
        result = await updateInterfaceLayout(interfaceId, body.layout, {
          expectedUpdatedAt: precededByOwnWrite ? undefined : body.expectedUpdatedAt,
        })
      }

      logger.info(`[${requestId}] Updated interface ${interfaceId}`)

      recordAudit({
        workspaceId: result.workspaceId,
        actorId: authResult.userId,
        actorName: authResult.userName ?? undefined,
        actorEmail: authResult.userEmail ?? undefined,
        action: AuditAction.INTERFACE_UPDATED,
        resourceType: AuditResourceType.INTERFACE,
        resourceId: result.id,
        resourceName: result.name,
        description: `Updated interface "${result.name}"`,
        request,
      })

      return NextResponse.json({ success: true, data: result })
    } catch (error) {
      const mapped = interfaceDomainErrorResponse(error)
      if (mapped) return mapped

      logger.error(`[${requestId}] Failed to update interface`, error)
      return NextResponse.json({ error: 'Failed to update interface' }, { status: 500 })
    }
  }
)

/** DELETE /api/interfaces/[interfaceId] - Archives an interface (soft delete). */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: InterfaceRouteParams) => {
    const requestId = generateRequestId()

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const parsed = await parseRequest(deleteInterfaceContract, request, context)
      if (!parsed.success) return parsed.response

      const { interfaceId } = parsed.data.params

      const access = await resolveInterfaceAccess({
        interfaceId,
        workspaceId: parsed.data.query.workspaceId,
        userId: authResult.userId,
        level: 'write',
        requestId,
      })
      if (!access.ok) return access.response

      const { definition } = access
      await deleteInterface(interfaceId)

      logger.info(`[${requestId}] Archived interface ${interfaceId}`)

      captureServerEvent(
        authResult.userId,
        'interface_deleted',
        { interface_id: definition.id, workspace_id: definition.workspaceId },
        { groups: { workspace: definition.workspaceId } }
      )

      recordAudit({
        workspaceId: definition.workspaceId,
        actorId: authResult.userId,
        actorName: authResult.userName ?? undefined,
        actorEmail: authResult.userEmail ?? undefined,
        action: AuditAction.INTERFACE_DELETED,
        resourceType: AuditResourceType.INTERFACE,
        resourceId: definition.id,
        resourceName: definition.name,
        description: `Deleted interface "${definition.name}"`,
        request,
      })

      return NextResponse.json({ success: true, data: { id: interfaceId } })
    } catch (error) {
      const mapped = interfaceDomainErrorResponse(error)
      if (mapped) return mapped

      logger.error(`[${requestId}] Failed to delete interface`, error)
      return NextResponse.json({ error: 'Failed to delete interface' }, { status: 500 })
    }
  }
)
