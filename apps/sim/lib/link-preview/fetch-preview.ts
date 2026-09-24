import { truncate } from '@sim/utils/string'
import * as cheerio from 'cheerio'
import sharp from 'sharp'
import type { LinkPreview } from '@/lib/api/contracts/link-preview'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'

const FETCH_TIMEOUT_MS = 5000
const PREVIEW_DEADLINE_MS = 8000
const MAX_HTML_BYTES = 1024 * 1024
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_PREVIEW_BYTES = 128 * 1024
const MAX_IMAGE_PIXELS = 16_000_000
const RASTER_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif'])

/** Public previews never forward credentials or allow a redirect into an insecure scheme. */
function assertPublicHttps(url: string) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Preview URLs must use HTTPS without credentials')
  }
}

/** Bounded raster thumbnail; the browser never contacts an untrusted og:image URL. */
async function fetchPreviewImage(url: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    assertPublicHttps(url)
    const response = await secureFetchWithValidation(url, {
      profile: 'contentFetch',
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 3,
      maxResponseBytes: MAX_IMAGE_BYTES,
      assertRedirectTarget: assertPublicHttps,
      signal,
      headers: { Accept: 'image/jpeg,image/png,image/webp,image/avif,image/gif' },
    })
    if (response.status < 200 || response.status >= 300) return undefined
    if (
      !/^image\/(jpeg|png|webp|avif|gif)(;|$)/i.test(response.headers.get('content-type') ?? '')
    ) {
      return undefined
    }
    const image = sharp(Buffer.from(await response.arrayBuffer()), {
      limitInputPixels: MAX_IMAGE_PIXELS,
      pages: 1,
    })
    const metadata = await image.metadata()
    if (!metadata.format || !RASTER_FORMATS.has(metadata.format)) return undefined
    signal?.throwIfAborted()
    const buffer = await image
      .rotate()
      .resize({ width: 640, height: 336, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .timeout({ seconds: 2 })
      .toBuffer()
    signal?.throwIfAborted()
    if (buffer.length > MAX_PREVIEW_BYTES) return undefined
    return `data:image/webp;base64,${buffer.toString('base64')}`
  } catch {
    signal?.throwIfAborted()
    return undefined
  }
}

/** Public-page metadata and an optional normalized image, each under the content-fetch SSRF policy. */
export async function fetchLinkPreview(
  url: string,
  callerSignal?: AbortSignal
): Promise<LinkPreview> {
  const deadline = AbortSignal.timeout(PREVIEW_DEADLINE_MS)
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline
  assertPublicHttps(url)
  let finalUrl = url
  const response = await secureFetchWithValidation(url, {
    profile: 'contentFetch',
    timeout: FETCH_TIMEOUT_MS,
    maxRedirects: 3,
    maxResponseBytes: MAX_HTML_BYTES,
    signal,
    assertRedirectTarget: (redirectUrl) => {
      assertPublicHttps(redirectUrl)
      finalUrl = redirectUrl
    },
    headers: {
      'User-Agent': 'Simbot/1.0 (+https://sim.ai)',
      Accept: 'text/html,application/xhtml+xml',
    },
  })
  if (response.status < 200 || response.status >= 300) return null
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml'))
    return null
  const $ = cheerio.load(await response.text())
  const meta = (key: string) =>
    $(`meta[property="${key}"], meta[name="${key}"]`).first().attr('content')?.trim() || null
  const title =
    meta('og:title') ?? meta('twitter:title') ?? ($('title').first().text().trim() || null)
  const description = meta('og:description') ?? meta('twitter:description') ?? meta('description')
  const siteName = meta('og:site_name')
  if (!title && !description && !siteName) return null
  const imageRef = meta('og:image:secure_url') ?? meta('og:image') ?? meta('twitter:image')
  let image: string | undefined
  if (imageRef) {
    try {
      image = await fetchPreviewImage(new URL(imageRef, finalUrl).href, signal)
    } catch {
      callerSignal?.throwIfAborted()
    }
  }
  callerSignal?.throwIfAborted()
  return {
    title: title ? truncate(title, 200) : null,
    description: description ? truncate(description, 300) : null,
    siteName: siteName ? truncate(siteName, 200) : null,
    ...(image ? { image } : {}),
  }
}
