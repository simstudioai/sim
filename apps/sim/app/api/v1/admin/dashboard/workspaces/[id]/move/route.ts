import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { adminDashboardWorkspaceMoveContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  moveWorkspaceToOrganization,
  toWorkspaceMoveOperationView,
  WorkspaceMoveError,
} from '@/lib/workspaces/admin-move'
import { getAdminAuditActor } from '@/app/api/v1/admin/dashboard/actor'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminDashboardWorkspaceMoveAPI')

interface RouteParams {
  id: string
}

export const POST = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardWorkspaceMoveContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const actor = await getAdminAuditActor(request)
      const summary = await moveWorkspaceToOrganization({
        workspaceId: parsed.data.params.id,
        destinationOrganizationId: parsed.data.body.destinationOrganizationId,
        expectedOwnerId: parsed.data.body.expectedOwnerId,
        adminEmail: request.headers.get('x-admin-email') ?? 'admin-api@sim.ai',
        auditActor: actor,
        auditOperationId: parsed.data.body.operationId,
        operationCorrelationId: parsed.data.body.operationId,
        durableOperationId: parsed.data.body.operationId,
      })
      const data = await toWorkspaceMoveOperationView(summary, parsed.data.body.operationId)
      return NextResponse.json({ data })
    } catch (error) {
      if (error instanceof WorkspaceMoveError) {
        if (error.code === 'workspace-not-found' || error.code === 'organization-not-found') {
          return notFoundResponse(
            error.code === 'workspace-not-found' ? 'Workspace' : 'Organization'
          )
        }
        return badRequestResponse(error.message)
      }
      logger.error('Failed to move workspace into organization', {
        error: getErrorMessage(error),
        workspaceId: parsed.data.params.id,
      })
      return internalErrorResponse('Failed to move workspace')
    }
  })
)
