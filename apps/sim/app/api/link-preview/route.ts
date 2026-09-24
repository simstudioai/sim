import { createHash } from 'crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { LinkPreview } from '@/lib/api/contracts/link-preview'
import { getLinkPreviewContract } from '@/lib/api/contracts/link-preview'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getRedisClient } from '@/lib/core/config/redis'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { enforceUserRateLimit } from '@/lib/core/rate-limiter/route-helpers'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { fetchLinkPreview } from '@/lib/link-preview/fetch-preview'

const logger = createLogger('LinkPreviewAPI')

const CACHE_TTL_SECONDS = 24 * 60 * 60
const NEGATIVE_CACHE_TTL_SECONDS = 60 * 60
const CACHE_KEY_PREFIX = 'link-preview:v2:'

export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimited = await enforceUserRateLimit('link-preview', session.user.id)
  if (rateLimited) return rateLimited

  const parsed = await parseRequest(getLinkPreviewContract, request, {})
  if (!parsed.success) return parsed.response
  const { url } = parsed.data.query

  if (!url.startsWith('https://')) {
    return NextResponse.json({ preview: null })
  }

  const redis = getRedisClient()
  const cacheKey = `${CACHE_KEY_PREFIX}${createHash('sha256').update(url).digest('hex')}`
  if (redis) {
    try {
      const cached = await redis.get(cacheKey)
      if (cached !== null) {
        return NextResponse.json({ preview: JSON.parse(cached) })
      }
    } catch (error) {
      logger.warn('Link preview cache read failed', { error })
    }
  }

  let preview: LinkPreview = null
  try {
    /** Link previews have no organization owner and use a shared URL cache. */
    preview = await runWithOutboundOrganization(null, () => fetchLinkPreview(url, request.signal))
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499 })
    logger.info('Link preview fetch failed; returning null preview', {
      host: new URL(url).hostname,
      error: getErrorMessage(error, 'unknown error').replaceAll(url, '[url]'),
    })
  }

  if (redis) {
    const ttl = preview ? CACHE_TTL_SECONDS : NEGATIVE_CACHE_TTL_SECONDS
    try {
      await redis.set(cacheKey, JSON.stringify(preview), 'EX', ttl)
    } catch (error) {
      logger.warn('Link preview cache write failed', { error })
    }
  }

  return NextResponse.json({ preview })
})
