import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { photonImessageSendVoiceContract } from '@/lib/api/contracts/tools/photon-imessage'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { materializePhotonFile } from '@/app/api/tools/photon_imessage/route-helpers'
import { sendPhotonVoiceMemo } from '@/app/api/tools/photon_imessage/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PhotonImessageSendVoiceAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Photon voice memo send attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(photonImessageSendVoiceContract, request, {})
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    const file = await materializePhotonFile(body, { requestId, userId: authResult.userId })
    if (file instanceof NextResponse) return file

    const output = await sendPhotonVoiceMemo({
      projectId: body.projectId,
      projectSecret: body.projectSecret,
      to: body.to,
      fileBuffer: file.buffer,
      fileName: file.fileName,
      mimeType: file.mimeType,
    })
    return NextResponse.json({ success: true, output })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Photon voice memo send failed:`, error)

    return NextResponse.json(
      { success: false, error: `Photon voice memo send failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
