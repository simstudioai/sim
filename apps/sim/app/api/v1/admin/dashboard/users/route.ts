import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listDashboardUsers } from '@/lib/admin/dashboard'
import { adminDashboardListUsersContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import { adminValidationErrorResponse, internalErrorResponse } from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminDashboardUsersAPI')

export const GET = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(
      adminDashboardListUsersContract,
      request,
      {},
      {
        validationErrorResponse: adminValidationErrorResponse,
      }
    )
    if (!parsed.success) return parsed.response
    try {
      return NextResponse.json(await listDashboardUsers(parsed.data.query))
    } catch (error) {
      logger.error('Failed to list dashboard users', { error })
      return internalErrorResponse('Failed to list users')
    }
  })
)
