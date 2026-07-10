import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { instagramPublishImageContract } from '@/lib/api/contracts/tools/instagram'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveInstagramMedia } from '@/lib/integrations/instagram/resolve-media'
import {
  createMediaContainer,
  publishMediaContainer,
  resolveIgUserId,
  waitForContainerReady,
} from '@/tools/instagram/utils'

export const dynamic = 'force-dynamic'
/** Meta may poll container status once per minute for up to five minutes. */
export const maxDuration = 600

const logger = createLogger('InstagramPublishImageAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Instagram publish image: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(instagramPublishImageContract, request, {})
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    const resolved = await resolveInstagramMedia({
      input: body.image,
      userId: authResult.userId,
      requestId,
      logger,
      role: 'image',
      label: 'Image',
    })
    if (resolved.error || !resolved.media) {
      return NextResponse.json(
        {
          success: false,
          error: resolved.error?.message || 'Failed to resolve image',
          output: { containerId: null, mediaId: null, statusCode: null },
        },
        { status: resolved.error?.status || 400 }
      )
    }

    const igUserId = await resolveIgUserId(body.accessToken, body.igUserId ?? undefined)
    const containerBody: Record<string, unknown> = {
      image_url: resolved.media.url,
    }
    if (body.caption) containerBody.caption = body.caption
    if (body.altText) containerBody.alt_text = body.altText
    if (body.isAiGenerated === true) containerBody.is_ai_generated = true

    const containerId = await createMediaContainer(body.accessToken, igUserId, containerBody)
    const { statusCode } = await waitForContainerReady(body.accessToken, containerId)
    const mediaId = await publishMediaContainer(body.accessToken, igUserId, containerId)

    return NextResponse.json({
      success: true,
      output: { containerId, mediaId, statusCode },
    })
  } catch (error) {
    logger.error(`[${requestId}] Instagram publish image failed:`, error)
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Failed to publish image'),
        output: { containerId: null, mediaId: null, statusCode: null },
      },
      { status: 500 }
    )
  }
})
