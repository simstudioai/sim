import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { adminDashboardWorkspaceMoveOperationContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkspaceMoveOperation, WorkspaceMoveError } from '@/lib/workspaces/admin-move'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import { badRequestResponse, internalErrorResponse } from '@/app/api/v1/admin/responses'

interface RouteParams {
  id: string
  operationId: string
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(
      adminDashboardWorkspaceMoveOperationContract,
      request,
      context
    )
    if (!parsed.success) return parsed.response
    try {
      return NextResponse.json({
        data: await getWorkspaceMoveOperation(
          parsed.data.params.id,
          parsed.data.query.destinationOrganizationId,
          parsed.data.query.expectedOwnerId,
          parsed.data.params.operationId
        ),
      })
    } catch (error) {
      if (error instanceof WorkspaceMoveError) return badRequestResponse(error.message)
      return internalErrorResponse(
        getErrorMessage(error, 'Could not load the workspace-move operation')
      )
    }
  })
)
