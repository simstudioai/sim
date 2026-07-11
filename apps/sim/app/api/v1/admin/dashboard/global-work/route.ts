import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { adminV1GetGlobalWorkContract } from '@/lib/api/contracts/v1/admin/global-work'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getGlobalWorkSummary } from '@/lib/global-work/summary'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import { adminValidationErrorResponse, internalErrorResponse } from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminGlobalWorkAPI')

export const GET = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(
      adminV1GetGlobalWorkContract,
      request,
      {},
      {
        validationErrorResponse: adminValidationErrorResponse,
      }
    )
    if (!parsed.success) return parsed.response

    try {
      const data = await getGlobalWorkSummary(parsed.data.query.month)
      return NextResponse.json({ data })
    } catch (error) {
      logger.error('Failed to build Global Work summary', { error })
      return internalErrorResponse('Failed to build Global Work summary')
    }
  })
)
