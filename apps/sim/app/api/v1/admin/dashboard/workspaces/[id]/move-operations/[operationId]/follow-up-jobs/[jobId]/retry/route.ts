import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { adminDashboardRetryWorkspaceMoveFollowUpContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { retryWorkspaceMoveFollowUpJob, WorkspaceMoveError } from '@/lib/workspaces/admin-move'
import { getAdminAuditActor } from '@/app/api/v1/admin/dashboard/actor'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import { badRequestResponse, internalErrorResponse } from '@/app/api/v1/admin/responses'

interface RouteParams {
  id: string
  operationId: string
  jobId: string
}

export const POST = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(
      adminDashboardRetryWorkspaceMoveFollowUpContract,
      request,
      context
    )
    if (!parsed.success) return parsed.response
    try {
      return NextResponse.json({
        data: await retryWorkspaceMoveFollowUpJob({
          workspaceId: parsed.data.params.id,
          destinationOrganizationId: parsed.data.body.destinationOrganizationId,
          expectedOwnerId: parsed.data.body.expectedOwnerId,
          operationId: parsed.data.params.operationId,
          jobEventId: parsed.data.params.jobId,
          actor: await getAdminAuditActor(request),
        }),
      })
    } catch (error) {
      if (error instanceof WorkspaceMoveError) return badRequestResponse(error.message)
      return internalErrorResponse(
        getErrorMessage(error, 'Could not retry the workspace-move follow-up job')
      )
    }
  })
)
