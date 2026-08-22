import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { photonImessageSendContract } from '@/lib/api/contracts/tools/communication/messaging'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { sendPhotonImessage } from '@/app/api/tools/photon_imessage/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PhotonImessageSendAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Photon iMessage send attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(photonImessageSendContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const result = await sendPhotonImessage({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      to: params.to,
      chatId: params.chatId,
      text: params.text,
    })

    logger.info(`[${requestId}] Sent Photon iMessage`, {
      chatId: result.chatId,
      addressedBy: params.chatId ? 'chatId' : 'to',
    })

    return NextResponse.json({ success: true, output: result })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Photon iMessage send failed:`, error)

    return NextResponse.json(
      { success: false, error: `Photon iMessage send failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
