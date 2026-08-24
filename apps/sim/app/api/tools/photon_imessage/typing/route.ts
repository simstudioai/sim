import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { photonImessageTypingContract } from '@/lib/api/contracts/tools/photon-imessage'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { setPhotonTyping } from '@/app/api/tools/photon_imessage/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PhotonImessageTypingAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(
        `[${requestId}] Unauthorized Photon typing indicator attempt: ${authResult.error}`
      )
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(photonImessageTypingContract, request, {})
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    const output = await setPhotonTyping({ ...body })
    return NextResponse.json({ success: true, output })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Photon typing indicator failed:`, error)

    return NextResponse.json(
      { success: false, error: `Photon typing indicator failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
