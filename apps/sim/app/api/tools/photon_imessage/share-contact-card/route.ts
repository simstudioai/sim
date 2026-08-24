import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { photonImessageShareContactCardContract } from '@/lib/api/contracts/tools/photon-imessage'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { sharePhotonContactCard } from '@/app/api/tools/photon_imessage/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PhotonImessageShareContactCardAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(
        `[${requestId}] Unauthorized Photon contact card share attempt: ${authResult.error}`
      )
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(photonImessageShareContactCardContract, request, {})
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    const output = await sharePhotonContactCard({ ...body })
    return NextResponse.json({ success: true, output })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Photon contact card share failed:`, error)

    return NextResponse.json(
      { success: false, error: `Photon contact card share failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
