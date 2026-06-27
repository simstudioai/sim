import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { uptimeRobotUpdatePspContract } from '@/lib/api/contracts/tools/uptimerobot'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { forwardPspRequest } from '@/app/api/tools/uptimerobot/server-utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('UptimeRobotUpdatePspAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized UptimeRobot update-psp request: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(uptimeRobotUpdatePspContract, request, {})
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    return forwardPspRequest({
      apiKey: body.apiKey,
      method: 'PATCH',
      path: `/psps/${body.pspId}`,
      fields: body,
      userId: authResult.userId,
      requestId,
      logger,
    })
  } catch (error) {
    logger.error(`[${requestId}] Unexpected error updating status page:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
})
