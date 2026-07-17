import { createHash } from 'crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import * as cheerio from 'cheerio'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { LinkPreview } from '@/lib/api/contracts/link-preview'
import { getLinkPreviewContract } from '@/lib/api/contracts/link-preview'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getRedisClient } from '@/lib/core/config/redis'
import { enforceUserRateLimit } from '@/lib/core/rate-limiter/route-helpers'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('LinkPreviewAPI')

const FETCH_TIMEOUT_MS = 5000
const MAX_RESPONSE_BYTES = 256 * 1024
const MAX_REDIRECTS = 3
const TITLE_MAX_CHARS = 200
const DESCRIPTION_MAX_CHARS = 300
const CACHE_TTL_SECONDS = 24 * 60 * 60
const NEGATIVE_CACHE_TTL_SECONDS = 60 * 60
const CACHE_KEY_PREFIX = 'link-preview:v1:'

/**
 * Parses preview metadata from the document head. Only the head matters for
 * previews, so the input is truncated at `<body>` before parsing; cheerio
 * handles attribute order, quoting, and entity decoding.
 */
function parsePreview(html: string): LinkPreview {
  const bodyIndex = html.search(/<body[\s>]/i)
  const $ = cheerio.load(bodyIndex === -1 ? html : html.slice(0, bodyIndex))

  const meta = (key: string): string | null => {
    const value = $(`meta[property="${key}"], meta[name="${key}"]`).first().attr('content')
    return value?.trim() || null
  }

  const title =
    meta('og:title') ?? meta('twitter:title') ?? ($('title').first().text().trim() || null)
  const description = meta('og:description') ?? meta('twitter:description') ?? meta('description')
  const siteName = meta('og:site_name')

  if (!title && !description && !siteName) return null
  return {
    title: title ? truncate(title, TITLE_MAX_CHARS) : null,
    description: description ? truncate(description, DESCRIPTION_MAX_CHARS) : null,
    siteName: siteName ? truncate(siteName, TITLE_MAX_CHARS) : null,
  }
}

async function fetchPreview(url: string): Promise<LinkPreview> {
  const response = await secureFetchWithValidation(url, {
    allowHttp: true,
    timeout: FETCH_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    headers: {
      'User-Agent': 'Simbot/1.0 (+https://sim.ai)',
      Accept: 'text/html,application/xhtml+xml',
    },
  })
  if (response.status < 200 || response.status >= 300) return null
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    return null
  }
  return parsePreview(await response.text())
}

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
    preview = await fetchPreview(url)
  } catch (error) {
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
