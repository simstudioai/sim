import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { photonImessageGroupAvatarContract } from '@/lib/api/contracts/tools/photon-imessage'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { materializePhotonFile } from '@/app/api/tools/photon_imessage/route-helpers'
import { setPhotonGroupAvatar } from '@/app/api/tools/photon_imessage/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PhotonImessageGroupAvatarAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(
        `[${requestId}] Unauthorized Photon group photo update attempt: ${authResult.error}`
      )
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(photonImessageGroupAvatarContract, request, {})
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    if (body.clear) {
      const output = await setPhotonGroupAvatar({
        projectId: body.projectId,
        projectSecret: body.projectSecret,
        chatId: body.chatId,
        clear: true,
      })
      return NextResponse.json({ success: true, output })
    }

    const file = await materializePhotonFile(body, { requestId, userId: authResult.userId })
    if (file instanceof NextResponse) return file

    const output = await setPhotonGroupAvatar({
      projectId: body.projectId,
      projectSecret: body.projectSecret,
      chatId: body.chatId,
      fileBuffer: file.buffer,
      fileName: file.fileName,
      mimeType: file.mimeType,
    })
    return NextResponse.json({ success: true, output })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Photon group photo update failed:`, error)

    return NextResponse.json(
      { success: false, error: `Photon group photo update failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
