import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { instagramPublishReelContract } from '@/lib/api/contracts/tools/instagram'
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

const logger = createLogger('InstagramPublishReelAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Instagram publish reel: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(instagramPublishReelContract, request, {})
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    const resolvedVideo = await resolveInstagramMedia({
      input: body.video,
      userId: authResult.userId,
      requestId,
      logger,
      role: 'video',
      label: 'Video',
    })
    if (resolvedVideo.error || !resolvedVideo.media) {
      return NextResponse.json(
        {
          success: false,
          error: resolvedVideo.error?.message || 'Failed to resolve video',
          output: { containerId: null, mediaId: null, statusCode: null },
        },
        { status: resolvedVideo.error?.status || 400 }
      )
    }

    let coverUrl: string | undefined
    if (body.cover != null && body.cover !== '') {
      const resolvedCover = await resolveInstagramMedia({
        input: body.cover,
        userId: authResult.userId,
        requestId,
        logger,
        role: 'cover',
        required: false,
        label: 'Cover image',
      })
      if (resolvedCover.error) {
        return NextResponse.json(
          {
            success: false,
            error: resolvedCover.error.message,
            output: { containerId: null, mediaId: null, statusCode: null },
          },
          { status: resolvedCover.error.status }
        )
      }
      coverUrl = resolvedCover.media?.url
    }

    const igUserId = await resolveIgUserId(body.accessToken, body.igUserId ?? undefined)
    const containerBody: Record<string, unknown> = {
      media_type: 'REELS',
      video_url: resolvedVideo.media.url,
    }
    if (body.caption) containerBody.caption = body.caption
    if (coverUrl) containerBody.cover_url = coverUrl
    if (body.shareToFeed !== undefined && body.shareToFeed !== null) {
      containerBody.share_to_feed = body.shareToFeed
    }
    if (body.thumbOffset != null) containerBody.thumb_offset = body.thumbOffset

    const containerId = await createMediaContainer(body.accessToken, igUserId, containerBody)
    const { statusCode } = await waitForContainerReady(body.accessToken, containerId)
    const mediaId = await publishMediaContainer(body.accessToken, igUserId, containerId)

    return NextResponse.json({
      success: true,
      output: { containerId, mediaId, statusCode },
    })
  } catch (error) {
    logger.error(`[${requestId}] Instagram publish reel failed:`, error)
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Failed to publish reel'),
        output: { containerId: null, mediaId: null, statusCode: null },
      },
      { status: 500 }
    )
  }
})
