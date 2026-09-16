import type { BrowserToolName } from '@sim/browser-protocol'
import { isRecordLike } from '@sim/utils/object'

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function imageDimensions(value: unknown): { width: number; height: number } | null {
  if (
    !isRecordLike(value) ||
    !finiteNumber(value.width) ||
    !finiteNumber(value.height) ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    return null
  }
  return { width: value.width, height: value.height }
}

/** Projects image bytes and coordinate metadata into the model's image-content contract. */
export function sanitizeBrowserToolResultForModel(
  toolName: BrowserToolName,
  result: unknown
): Record<string, unknown> | undefined {
  if (!isRecordLike(result)) {
    return result === undefined ? undefined : { value: result }
  }
  if (toolName !== 'browser_screenshot' || typeof result.dataUrl !== 'string') return result

  const { dataUrl, ...rest } = result
  const image = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl)
  if (!image) {
    return {
      ...rest,
      note: 'The screenshot could not be encoded. Use browser_snapshot or browser_read_text instead.',
    }
  }
  const viewport = isRecordLike(rest.viewport) ? rest.viewport : null
  const screenshotUrl =
    typeof rest.url === 'string' && rest.url
      ? rest.url
      : viewport && typeof viewport.url === 'string'
        ? viewport.url
        : ''
  const location = screenshotUrl ? ` of ${screenshotUrl}` : ''
  const clip = isRecordLike(rest.clip) ? rest.clip : null
  const cropSize = imageDimensions(clip)
  const viewportSize = imageDimensions(viewport)
  const imageSize = imageDimensions(rest.imageSize)
  const capturedSize = clip ? cropSize : viewportSize
  const scaleX = imageSize && capturedSize ? imageSize.width / capturedSize.width : null
  const scaleY = imageSize && capturedSize ? imageSize.height / capturedSize.height : null
  const hasScale = finiteNumber(scaleX) && scaleX > 0 && finiteNumber(scaleY) && scaleY > 0
  const origin = clip
    ? finiteNumber(clip.x) && finiteNumber(clip.y)
      ? { x: clip.x, y: clip.y }
      : null
    : { x: 0, y: 0 }
  const content = [
    `Screenshot${location}. This is the rendered ${clip ? 'element' : 'viewport'} only — it carries no element ids, so use browser_snapshot before interacting.`,
    viewportSize && `Viewport: ${viewportSize.width} × ${viewportSize.height} CSS pixels.`,
    imageSize && `Encoded image: ${imageSize.width} × ${imageSize.height} pixels.`,
    hasScale && `Image scale: X=${scaleX}, Y=${scaleY} encoded image pixels per CSS pixel.`,
    cropSize && `Crop size: ${cropSize.width} × ${cropSize.height} CSS pixels.`,
    clip && origin && `Crop origin: (${origin.x}, ${origin.y}) in viewport CSS pixels.`,
    hasScale && origin
      ? `Coordinate actions use viewport CSS pixels: cssX = ${origin.x} + imageX / ${scaleX}; cssY = ${origin.y} + imageY / ${scaleY}. imageX/imageY refer to the encoded image before any display resizing.`
      : 'Screenshot coordinate mapping is unavailable; use browser_snapshot element references or take a new viewport screenshot before coordinate actions.',
  ]
    .filter(Boolean)
    .join(' ')
  return {
    ...rest,
    content,
    attachment: {
      type: 'image',
      source: { type: 'base64', media_type: image[1], data: image[2] },
    },
  }
}
