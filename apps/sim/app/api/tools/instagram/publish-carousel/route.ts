import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { instagramPublishCarouselContract } from '@/lib/api/contracts/tools/instagram'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveInstagramCarouselMedia } from '@/lib/integrations/instagram/resolve-media'
import {
  createMediaContainer,
  publishMediaContainer,
  resolveIgUserId,
  waitForContainerReady,
} from '@/tools/instagram/utils'

export const dynamic = 'force-dynamic'
/**
 * Children are polled in parallel, so the worst case is one five-minute poll
 * window for the children plus another for the parent container.
 */
export const maxDuration = 900

const logger = createLogger('InstagramPublishCarouselAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Instagram publish carousel: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(instagramPublishCarouselContract, request, {})
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    const resolved = await resolveInstagramCarouselMedia(
      body.media,
      authResult.userId,
      requestId,
      logger
    )
    if (resolved.error || !resolved.items) {
      return NextResponse.json(
        {
          success: false,
          error: resolved.error?.message || 'Failed to resolve carousel media',
          output: { containerId: null, mediaId: null, statusCode: null },
        },
        { status: resolved.error?.status || 400 }
      )
    }

    const igUserId = await resolveIgUserId(body.accessToken, body.igUserId ?? undefined)

    // Create every child container before polling any of them: Meta fetches each
    // media URL at container creation, so presigned links are consumed while
    // fresh, and polling in parallel bounds the total wait to a single
    // five-minute window instead of five minutes per item.
    const childIds: string[] = []
    for (const item of resolved.items) {
      const childBody: Record<string, unknown> = {
        is_carousel_item: true,
      }
      if (item.kind === 'video') {
        childBody.media_type = 'VIDEO'
        childBody.video_url = item.url
      } else {
        childBody.image_url = item.url
      }
      childIds.push(await createMediaContainer(body.accessToken, igUserId, childBody))
    }

    // allSettled so a fast-failing child doesn't leave sibling polls rejecting
    // with no handler (Node terminates on unhandled rejections).
    const childResults = await Promise.allSettled(
      childIds.map((childId) => waitForContainerReady(body.accessToken, childId))
    )
    const failedChild = childResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (failedChild) {
      throw failedChild.reason
    }

    const parentBody: Record<string, unknown> = {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
    }
    if (body.caption) parentBody.caption = body.caption

    const containerId = await createMediaContainer(body.accessToken, igUserId, parentBody)
    const { statusCode } = await waitForContainerReady(body.accessToken, containerId)
    const mediaId = await publishMediaContainer(body.accessToken, igUserId, containerId)

    return NextResponse.json({
      success: true,
      output: { containerId, mediaId, statusCode },
    })
  } catch (error) {
    logger.error(`[${requestId}] Instagram publish carousel failed:`, error)
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Failed to publish carousel'),
        output: { containerId: null, mediaId: null, statusCode: null },
      },
      { status: 500 }
    )
  }
})
