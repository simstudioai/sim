import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listDashboardOrganizations } from '@/lib/admin/dashboard'
import { adminDashboardListOrganizationsContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import { adminValidationErrorResponse, internalErrorResponse } from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminDashboardOrganizationsAPI')

export const GET = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(
      adminDashboardListOrganizationsContract,
      request,
      {},
      {
        validationErrorResponse: adminValidationErrorResponse,
      }
    )
    if (!parsed.success) return parsed.response
    try {
      return NextResponse.json(await listDashboardOrganizations(parsed.data.query))
    } catch (error) {
      logger.error('Failed to list dashboard organizations', { error })
      return internalErrorResponse('Failed to list organizations')
    }
  })
)
