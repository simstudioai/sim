import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { uptimeRobotCreatePspContract } from '@/lib/api/contracts/tools/uptimerobot'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { forwardPspRequest } from '@/app/api/tools/uptimerobot/server-utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('UptimeRobotCreatePspAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized UptimeRobot create-psp request: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(uptimeRobotCreatePspContract, request, {})
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    return forwardPspRequest({
      apiKey: body.apiKey,
      method: 'POST',
      path: '/psps',
      fields: body,
      userId: authResult.userId,
      requestId,
      logger,
    })
  } catch (error) {
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    logger.error(`[${requestId}] Unexpected error creating status page:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
})
