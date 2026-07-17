import { createLogger } from '@sim/logger'
import { truncate } from '@sim/utils/string'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { LinkPreview } from '@/lib/api/contracts/link-preview'
import { getLinkPreviewContract } from '@/lib/api/contracts/link-preview'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getRedisClient } from '@/lib/core/config/redis'
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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
}

/**
 * Content of a `<meta>` tag matched by `property` or `name`, handling either
 * attribute order. Only the document head matters for previews, so callers
 * pass a head-truncated HTML string.
 */
function metaContent(html: string, key: string): string | null {
  const attr = `(?:property|name)=["']${key}["']`
  const patterns = [
    new RegExp(`<meta[^>]*${attr}[^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return decodeHtmlEntities(match[1]).trim() || null
  }
  return null
}

function parsePreview(html: string): LinkPreview {
  const bodyIndex = html.search(/<body[\s>]/i)
  const head = bodyIndex === -1 ? html : html.slice(0, bodyIndex)

  const titleTag = head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
  const title =
    metaContent(head, 'og:title') ??
    metaContent(head, 'twitter:title') ??
    (titleTag ? decodeHtmlEntities(titleTag).trim() || null : null)
  const description =
    metaContent(head, 'og:description') ??
    metaContent(head, 'twitter:description') ??
    metaContent(head, 'description')
  const siteName = metaContent(head, 'og:site_name')

  if (!title && !description && !siteName) return null
  return {
    title: title ? truncate(title, TITLE_MAX_CHARS) : null,
    description: description ? truncate(description, DESCRIPTION_MAX_CHARS) : null,
    siteName: siteName ? truncate(siteName, TITLE_MAX_CHARS) : null,
  }
}

async function fetchPreview(url: string): Promise<LinkPreview> {
  const response = await secureFetchWithValidation(url, {
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

  const parsed = await parseRequest(getLinkPreviewContract, request, {})
  if (!parsed.success) return parsed.response
  const { url } = parsed.data.query

  const redis = getRedisClient()
  const cacheKey = `${CACHE_KEY_PREFIX}${url}`
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
    logger.info('Link preview fetch failed; returning null preview', { url, error })
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
