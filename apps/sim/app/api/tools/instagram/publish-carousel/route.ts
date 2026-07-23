import { createLogger, getRequestContext } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { instagramPublishCarouselContract } from '@/lib/api/contracts/tools/instagram'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
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
  const requestId = getRequestContext()?.requestId ?? 'unknown'

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn('Unauthorized Instagram publish carousel', { error: authResult.error })
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

    const igUserId = await resolveIgUserId(
      body.accessToken,
      body.igUserId ?? undefined,
      request.signal
    )

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
      childIds.push(
        await createMediaContainer(body.accessToken, igUserId, childBody, request.signal)
      )
    }

    const childResults = await Promise.allSettled(
      childIds.map((childId) => waitForContainerReady(body.accessToken, childId, request.signal))
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

    const containerId = await createMediaContainer(
      body.accessToken,
      igUserId,
      parentBody,
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
    logger.error('Instagram publish carousel failed', { error })
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
