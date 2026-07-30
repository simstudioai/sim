import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { adminDashboardWorkspacePreflightContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkspaceMovePreflight, WorkspaceMoveError } from '@/lib/workspaces/admin-move'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminDashboardWorkspacePreflightAPI')

interface RouteParams {
  id: string
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardWorkspacePreflightContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const data = await getWorkspaceMovePreflight(
        parsed.data.params.id,
        parsed.data.query.destinationOrganizationId
      )
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
      logger.error('Failed to build workspace move preflight', {
        error: getErrorMessage(error),
        workspaceId: parsed.data.params.id,
      })
      return internalErrorResponse('Failed to build workspace move preflight')
    }
  })
)
