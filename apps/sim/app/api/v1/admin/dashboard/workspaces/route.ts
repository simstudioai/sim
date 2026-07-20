import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { adminDashboardWorkspaceSearchContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { searchWorkspaceMoveCandidates } from '@/lib/workspaces/admin-move'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import { internalErrorResponse } from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminDashboardWorkspacesAPI')

export const GET = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(adminDashboardWorkspaceSearchContract, request, {})
    if (!parsed.success) return parsed.response

    try {
      const data = await searchWorkspaceMoveCandidates(
        parsed.data.query.search,
        parsed.data.query.limit
      )
      return NextResponse.json({ data })
    } catch (error) {
      logger.error('Failed to search workspace move candidates', {
        error: getErrorMessage(error),
      })
      return internalErrorResponse('Failed to search workspaces')
    }
  })
)
