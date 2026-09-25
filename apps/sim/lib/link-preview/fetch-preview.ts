import { truncate } from '@sim/utils/string'
import * as cheerio from 'cheerio'
import sharp from 'sharp'
import type { LinkPreview } from '@/lib/api/contracts/link-preview'
import { isRetryableInfrastructureError } from '@/lib/core/errors/retryable-infrastructure'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'

const FETCH_TIMEOUT_MS = 5000
const PREVIEW_DEADLINE_MS = 8000
const MAX_HTML_BYTES = 1024 * 1024
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_PREVIEW_BYTES = 128 * 1024
const MAX_IMAGE_PIXELS = 16_000_000
const RASTER_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif'])
const MAX_CONCURRENT_IMAGES = 2
let activeImages = 0

type PreviewImage = Pick<NonNullable<LinkPreview>, 'image' | 'imageRetryable'>

/** Public previews never forward credentials or allow a redirect into an insecure scheme. */
function assertPublicHttps(url: string) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Preview URLs must use HTTPS without credentials')
  }
}

/** Bounded raster thumbnail; the browser never contacts an untrusted og:image URL. */
async function fetchPreviewImage(url: string, signal?: AbortSignal): Promise<PreviewImage> {
  try {
    assertPublicHttps(url)
  } catch {
    return {}
  }
  /** Skip optional work at capacity rather than queueing image buffers across requests. */
  if (activeImages >= MAX_CONCURRENT_IMAGES) return { imageRetryable: true }
  activeImages += 1
  try {
    const response = await secureFetchWithValidation(url, {
      profile: 'contentFetch',
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 3,
      maxResponseBytes: MAX_IMAGE_BYTES,
      assertRedirectTarget: assertPublicHttps,
      signal,
      headers: { Accept: 'image/jpeg,image/png,image/webp,image/avif,image/gif' },
    })
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => {})
      return response.status === 429 || response.status >= 500 ? { imageRetryable: true } : {}
    }
    if (
      !/^image\/(jpeg|png|webp|avif|gif)(;|$)/i.test(response.headers.get('content-type') ?? '')
    ) {
      await response.body?.cancel().catch(() => {})
      return {}
    }
    const image = sharp(Buffer.from(await response.arrayBuffer()), {
      limitInputPixels: MAX_IMAGE_PIXELS,
      pages: 1,
    }).timeout({ seconds: 2 })
    const metadata = await image.metadata()
    if (!metadata.format || !RASTER_FORMATS.has(metadata.format)) return {}
    signal?.throwIfAborted()
    const buffer = await image
      .rotate()
      .resize({ width: 640, height: 336, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer()
    signal?.throwIfAborted()
    if (buffer.length > MAX_PREVIEW_BYTES) return {}
    return { image: `data:image/webp;base64,${buffer.toString('base64')}` }
  } catch (error) {
    signal?.throwIfAborted()
    return isRetryableInfrastructureError(error) ? { imageRetryable: true } : {}
  } finally {
    activeImages -= 1
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
  const contentType = (response.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()
  if (
    response.status < 200 ||
    response.status >= 300 ||
    (contentType !== 'text/html' && contentType !== 'application/xhtml+xml')
  ) {
    await response.body?.cancel().catch(() => {})
    return null
  }
  const $ = cheerio.load(await response.text())
  const meta = (key: string) =>
    $(`meta[property="${key}"], meta[name="${key}"]`).first().attr('content')?.trim() || null
  const title =
    meta('og:title') ?? meta('twitter:title') ?? ($('title').first().text().trim() || null)
  const description = meta('og:description') ?? meta('twitter:description') ?? meta('description')
  const siteName = meta('og:site_name')
  if (!title && !description && !siteName) return null
  const imageRef = meta('og:image:secure_url') ?? meta('og:image') ?? meta('twitter:image')
  let image: PreviewImage = {}
  if (imageRef) {
    try {
      image = await fetchPreviewImage(new URL(imageRef, finalUrl).href, signal)
    } catch {
      callerSignal?.throwIfAborted()
      image = signal.aborted ? { imageRetryable: true } : {}
    }
  }
  callerSignal?.throwIfAborted()
  return {
    title: title ? truncate(title, 200) : null,
    description: description ? truncate(description, 300) : null,
    siteName: siteName ? truncate(siteName, 200) : null,
    ...image,
  }
}
