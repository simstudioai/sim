import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { instagramPublishStoryContract } from '@/lib/api/contracts/tools/instagram'
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

const logger = createLogger('InstagramPublishStoryAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Instagram publish story: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(instagramPublishStoryContract, request, {})
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    const resolved = await resolveInstagramMedia({
      input: body.media,
      userId: authResult.userId,
      requestId,
      logger,
      role: 'story',
      label: 'Story media',
    })
    if (resolved.error || !resolved.media) {
      return NextResponse.json(
        {
          success: false,
          error: resolved.error?.message || 'Failed to resolve story media',
          output: { containerId: null, mediaId: null, statusCode: null },
        },
        { status: resolved.error?.status || 400 }
      )
    }

    const igUserId = await resolveIgUserId(
      body.accessToken,
      body.igUserId ?? undefined,
      request.signal
    )
    const containerBody: Record<string, unknown> = {
      media_type: 'STORIES',
    }
    if (resolved.media.kind === 'video') {
      containerBody.video_url = resolved.media.url
    } else {
      containerBody.image_url = resolved.media.url
    }

    const containerId = await createMediaContainer(
      body.accessToken,
      igUserId,
      containerBody,
      request.signal
    )
    const { statusCode } = await waitForContainerReady(
      body.accessToken,
      containerId,
      request.signal
    )
    const mediaId = await publishMediaContainer(
      body.accessToken,
      igUserId,
      containerId,
      request.signal
    )

    return NextResponse.json({
      success: true,
      output: { containerId, mediaId, statusCode },
    })
  } catch (error) {
    logger.error(`[${requestId}] Instagram publish story failed:`, error)
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Failed to publish story'),
        output: { containerId: null, mediaId: null, statusCode: null },
      },
      { status: 500 }
    )
  }
})
