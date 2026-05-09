/**
 * Image renderer — converts PicNodeData into positioned HTML image/video/audio elements.
 */

import type { PicNodeData } from '../model/nodes/pic-node'
import { hexToRgb } from '../utils/color'
import { parseEmfContent } from '../utils/emf-parser'
import { getOrCreateBlobUrl, resolveMediaPath } from '../utils/media'
import { renderPdfToImage } from '../utils/pdf-renderer'
import type { RenderContext } from './render-context'
import { resolveColor } from './style-resolver'

/**
 * Check if a file extension is an unsupported legacy format (WMF only now; EMF is handled).
 */
function isUnsupportedFormat(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return ext === 'wmf'
}

/**
 * Check if a file path is an EMF image.
 */
function isEmfFormat(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return ext === 'emf'
}

// ---------------------------------------------------------------------------
// Image Rendering
// ---------------------------------------------------------------------------

/**
 * Render a picture node into an absolutely-positioned HTML element.
 *
 * Handles:
 * - Standard images (png, jpg, gif, svg, bmp)
 * - Unsupported formats (emf, wmf) with placeholder
 * - Video elements with controls
 * - Audio elements with controls
 * - Crop via CSS clip-path
 * - Rotation and flip transforms
 */
export function renderImage(node: PicNodeData, ctx: RenderContext): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.position = 'absolute'
  wrapper.style.left = `${node.position.x}px`
  wrapper.style.top = `${node.position.y}px`
  wrapper.style.width = `${node.size.w}px`
  wrapper.style.height = `${node.size.h}px`
  wrapper.style.overflow = 'hidden'

  // Apply transforms
  const transforms: string[] = []
  if (node.rotation !== 0) {
    transforms.push(`rotate(${node.rotation}deg)`)
  }
  if (node.flipH) {
    transforms.push('scaleX(-1)')
  }
  if (node.flipV) {
    transforms.push('scaleY(-1)')
  }
  if (transforms.length > 0) {
    wrapper.style.transform = transforms.join(' ')
  }

  // ---- Handle video ----
  if (node.isVideo) {
    renderVideo(node, ctx, wrapper)
    return wrapper
  }

  // ---- Handle audio ----
  if (node.isAudio) {
    renderAudio(node, ctx, wrapper)
    return wrapper
  }

  // ---- Resolve image data ----
  const embedId = node.blipEmbed
  if (!embedId) {
    renderPlaceholder(wrapper, 'No image data')
    return wrapper
  }

  const rel = ctx.slide.rels.get(embedId)
  if (!rel) {
    renderPlaceholder(wrapper, 'Missing image reference')
    return wrapper
  }

  const mediaPath = resolveMediaPath(rel.target)

  // Check for unsupported formats (WMF)
  if (isUnsupportedFormat(mediaPath)) {
    renderUnsupportedPlaceholder(wrapper, mediaPath)
    return wrapper
  }

  const data = ctx.presentation.media.get(mediaPath)
  if (!data) {
    renderPlaceholder(wrapper, 'Image not found')
    return wrapper
  }

  // Handle EMF images — extract embedded PDF/bitmap content
  if (isEmfFormat(mediaPath)) {
    const emfData = data instanceof Uint8Array ? data : new Uint8Array(data)
    renderEmf(emfData, node, ctx, wrapper, mediaPath)
    return wrapper
  }

  // Create blob URL (with caching)
  const url = getOrCreateBlobUrl(mediaPath, data, ctx.mediaUrlCache)

  // Create image element
  const img = document.createElement('img')
  img.src = url
  img.style.width = '100%'
  img.style.height = '100%'
  img.style.objectFit = 'fill'
  img.style.display = 'block'
  img.draggable = false

  // Apply crop if present.
  // OOXML srcRect defines what portion of the source image is cropped away.
  // The REMAINING visible region must stretch to fill the entire shape bounding box.
  // We achieve this by scaling the <img> larger than the wrapper and offsetting it,
  // relying on the wrapper's overflow:hidden to clip.
  if (node.crop) {
    const { top, right, bottom, left } = node.crop
    // Visible fraction of original image in each dimension
    const visibleW = 1 - left - right
    const visibleH = 1 - top - bottom
    // Guard against degenerate crops (<=0 visible)
    if (visibleW > 0.001 && visibleH > 0.001) {
      // Scale image so the visible portion fills the wrapper exactly
      const scaleX = 1 / visibleW // e.g. if 95.4% visible → scale to ~104.8%
      const scaleY = 1 / visibleH
      // Use pixel values for offset — CSS margin-top/margin-left percentages are
      // both relative to the containing block's WIDTH (not height), which causes
      // incorrect offsets for non-square wrappers with significant crops.
      const wrapperW = node.size.w
      const wrapperH = node.size.h
      img.style.width = `${(scaleX * wrapperW).toFixed(4)}px`
      img.style.height = `${(scaleY * wrapperH).toFixed(4)}px`
      img.style.marginLeft = `${(-left * scaleX * wrapperW).toFixed(4)}px`
      img.style.marginTop = `${(-top * scaleY * wrapperH).toFixed(4)}px`
    }
  }

  // --- Blip effects ---
  const blip = node.source.child('blipFill').child('blip')
  const blipOpacity = resolveBlipOpacity(blip)
  if (blipOpacity < 1) {
    wrapper.style.opacity = `${Number(blipOpacity.toFixed(4))}`
  }

  // Duotone: recolor image (dark→color1, light→color2)
  const duotone = blip.child('duotone')
  if (duotone.exists()) {
    applyDuotoneFilter(duotone, ctx, img, wrapper)
  }

  // Luminance: brightness/contrast adjustment
  const lum = blip.child('lum')
  if (lum.exists()) {
    applyLumEffect(lum, img)
  }

  // BiLevel: threshold to black/white
  const biLevel = blip.child('biLevel')
  if (biLevel.exists()) {
    applyBiLevelEffect(biLevel, img)
  }

  wrapper.appendChild(img)
  return wrapper
}

/**
 * Resolve overall image opacity from OOXML blip alpha modifiers.
 *
 * Supported today:
 * - alphaModFix amt="N"
 * - alphaMod val="N"
 * - alphaOff val="N"
 */
function resolveBlipOpacity(blip: SafeXmlNode): number {
  let alpha = 1

  const alphaModFix = blip.child('alphaModFix')
  if (alphaModFix.exists()) {
    alpha *= (alphaModFix.numAttr('amt') ?? 100000) / 100000
  }

  const alphaMod = blip.child('alphaMod')
  if (alphaMod.exists()) {
    alpha *= (alphaMod.numAttr('val') ?? 100000) / 100000
  }

  const alphaOff = blip.child('alphaOff')
  if (alphaOff.exists()) {
    alpha += (alphaOff.numAttr('val') ?? 0) / 100000
  }

  return Math.max(0, Math.min(1, alpha))
}

/**
 * Render a video element inside the wrapper.
 */
function renderVideo(node: PicNodeData, ctx: RenderContext, wrapper: HTMLElement): void {
  // Try to get video URL from mediaRId
  const videoUrl = resolveMediaUrl(node.mediaRId, ctx)

  // Also try to show poster image from blipEmbed
  let posterUrl: string | undefined
  if (node.blipEmbed) {
    const rel = ctx.slide.rels.get(node.blipEmbed)
    if (rel) {
      const mediaPath = resolveMediaPath(rel.target)
      const data = ctx.presentation.media.get(mediaPath)
      if (data && !isUnsupportedFormat(mediaPath)) {
        posterUrl = getOrCreateBlobUrl(mediaPath, data, ctx.mediaUrlCache)
      }
    }
  }

  if (videoUrl) {
    const video = document.createElement('video')
    video.src = videoUrl
    video.controls = true
    video.style.width = '100%'
    video.style.height = '100%'
    video.style.objectFit = 'contain'
    video.style.backgroundColor = '#000'
    if (posterUrl) {
      video.poster = posterUrl
    }
    wrapper.appendChild(video)
  } else if (posterUrl) {
    // No video data available — show poster with play overlay
    const img = document.createElement('img')
    img.src = posterUrl
    img.style.width = '100%'
    img.style.height = '100%'
    img.style.objectFit = 'fill'
    wrapper.appendChild(img)

    const overlay = document.createElement('div')
    overlay.style.position = 'absolute'
    overlay.style.inset = '0'
    overlay.style.display = 'flex'
    overlay.style.alignItems = 'center'
    overlay.style.justifyContent = 'center'
    overlay.style.backgroundColor = 'rgba(0,0,0,0.3)'
    overlay.style.color = '#fff'
    overlay.style.fontSize = '24px'
    overlay.textContent = '\u25B6' // play symbol
    wrapper.appendChild(overlay)
  } else {
    renderPlaceholder(wrapper, 'Video')
  }
}

/**
 * Render an audio element inside the wrapper.
 */
function renderAudio(node: PicNodeData, ctx: RenderContext, wrapper: HTMLElement): void {
  const audioUrl = resolveMediaUrl(node.mediaRId, ctx)

  if (audioUrl) {
    // Show poster image if available
    if (node.blipEmbed) {
      const rel = ctx.slide.rels.get(node.blipEmbed)
      if (rel) {
        const mediaPath = resolveMediaPath(rel.target)
        const data = ctx.presentation.media.get(mediaPath)
        if (data && !isUnsupportedFormat(mediaPath)) {
          const cached = getOrCreateBlobUrl(mediaPath, data, ctx.mediaUrlCache)
          const img = document.createElement('img')
          img.src = cached
          img.style.width = '100%'
          img.style.height = 'calc(100% - 32px)'
          img.style.objectFit = 'contain'
          wrapper.appendChild(img)
        }
      }
    }

    const audio = document.createElement('audio')
    audio.src = audioUrl
    audio.controls = true
    audio.style.width = '100%'
    audio.style.position = 'absolute'
    audio.style.bottom = '0'
    audio.style.left = '0'
    wrapper.appendChild(audio)
  } else {
    renderPlaceholder(wrapper, 'Audio')
  }
}

/**
 * Resolve a media URL from a relationship ID.
 */
function resolveMediaUrl(rId: string | undefined, ctx: RenderContext): string | undefined {
  if (!rId) return undefined

  const rel = ctx.slide.rels.get(rId)
  if (!rel) return undefined

  // Check if target is an external URL
  if (rel.target.startsWith('http://') || rel.target.startsWith('https://')) {
    return rel.target
  }

  // Resolve from embedded media
  const mediaPath = resolveMediaPath(rel.target)
  const data = ctx.presentation.media.get(mediaPath)
  if (!data) return undefined

  return getOrCreateBlobUrl(mediaPath, data, ctx.mediaUrlCache)
}

/**
 * Render a placeholder div for missing or error content.
 */
function renderPlaceholder(wrapper: HTMLElement, message: string): void {
  const placeholder = document.createElement('div')
  placeholder.style.width = '100%'
  placeholder.style.height = '100%'
  placeholder.style.display = 'flex'
  placeholder.style.alignItems = 'center'
  placeholder.style.justifyContent = 'center'
  placeholder.style.backgroundColor = '#f0f0f0'
  placeholder.style.color = '#888'
  placeholder.style.fontSize = '12px'
  placeholder.style.border = '1px dashed #ccc'
  placeholder.textContent = message
  wrapper.appendChild(placeholder)
}

/**
 * Render a placeholder for unsupported image formats (WMF).
 */
function renderUnsupportedPlaceholder(wrapper: HTMLElement, path: string): void {
  const ext = path.split('.').pop()?.toUpperCase() || 'Unknown'
  const placeholder = document.createElement('div')
  placeholder.style.width = '100%'
  placeholder.style.height = '100%'
  placeholder.style.display = 'flex'
  placeholder.style.flexDirection = 'column'
  placeholder.style.alignItems = 'center'
  placeholder.style.justifyContent = 'center'
  placeholder.style.backgroundColor = '#f5f5f5'
  placeholder.style.color = '#999'
  placeholder.style.fontSize = '11px'
  placeholder.style.border = '1px dashed #ddd'

  const icon = document.createElement('div')
  icon.style.fontSize = '24px'
  icon.style.marginBottom = '4px'
  icon.textContent = '\uD83D\uDDBC' // framed picture emoji

  const label = document.createElement('div')
  label.textContent = `Unsupported format: ${ext}`

  placeholder.appendChild(icon)
  placeholder.appendChild(label)
  wrapper.appendChild(placeholder)
}

// ---------------------------------------------------------------------------
// EMF Rendering
// ---------------------------------------------------------------------------

/**
 * Render EMF content by extracting embedded PDF or bitmap data.
 */
function renderEmf(
  data: Uint8Array,
  node: PicNodeData,
  ctx: RenderContext,
  wrapper: HTMLElement,
  mediaPath: string
): void {
  const content = parseEmfContent(data)

  switch (content.type) {
    case 'pdf':
      renderEmfPdf(content.data, wrapper, node, ctx, mediaPath)
      break
    case 'bitmap':
      renderEmfBitmap(content.imageData, wrapper, ctx, mediaPath)
      break
    case 'empty':
      // Render nothing — transparent placeholder
      break
    case 'unsupported':
      renderUnsupportedPlaceholder(wrapper, mediaPath)
      break
  }
}

/**
 * Render an embedded PDF from EMF using pdfjs-dist.
 * Populates the wrapper asynchronously — the wrapper is returned immediately.
 */
function renderEmfPdf(
  pdfData: Uint8Array,
  wrapper: HTMLElement,
  node: PicNodeData,
  ctx: RenderContext,
  mediaPath: string
): void {
  const cacheKey = `${mediaPath}:emf-pdf`
  const cached = ctx.mediaUrlCache.get(cacheKey)
  if (cached) {
    wrapper.appendChild(createFillImage(cached))
    return
  }

  renderPdfToImage(pdfData, node.size.w, node.size.h)
    .then((url) => {
      if (url) {
        ctx.mediaUrlCache.set(cacheKey, url)
        wrapper.appendChild(createFillImage(url))
      }
    })
    .catch(() => {
      // PDF rendering failed — leave wrapper empty (transparent)
    })
}

/**
 * Render an embedded DIB bitmap from EMF.
 */
function renderEmfBitmap(
  imageData: ImageData,
  wrapper: HTMLElement,
  ctx: RenderContext,
  mediaPath: string
): void {
  const cacheKey = `${mediaPath}:emf-bitmap`
  const cached = ctx.mediaUrlCache.get(cacheKey)
  if (cached) {
    wrapper.appendChild(createFillImage(cached))
    return
  }

  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const canvasCtx = canvas.getContext('2d')
  if (!canvasCtx) return

  canvasCtx.putImageData(imageData, 0, 0)
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    ctx.mediaUrlCache.set(cacheKey, url)
    wrapper.appendChild(createFillImage(url))
  }, 'image/png')
}

/**
 * Create an <img> element that fills its container.
 */
function createFillImage(url: string): HTMLImageElement {
  const img = document.createElement('img')
  img.src = url
  img.style.width = '100%'
  img.style.height = '100%'
  img.style.objectFit = 'fill'
  img.style.display = 'block'
  img.draggable = false
  return img
}

// ---------------------------------------------------------------------------
// Duotone Effect
// ---------------------------------------------------------------------------

import type { SafeXmlNode } from '../parser/xml-parser'

/**
 * Apply a duotone effect to an image via canvas pixel manipulation.
 *
 * OOXML `<a:duotone>` contains two color children (dark and light).
 * The image is converted to grayscale, then black→color1, white→color2.
 */
function applyDuotoneFilter(
  duotone: SafeXmlNode,
  ctx: RenderContext,
  img: HTMLImageElement,
  _wrapper: HTMLElement
): void {
  // Extract the two colors (first = dark, second = light)
  const colorChildren = duotone.allChildren()
  if (colorChildren.length < 2) return

  const { color: c1 } = resolveColor(colorChildren[0], ctx)
  const { color: c2 } = resolveColor(colorChildren[1], ctx)
  if (!c1 || !c2) return

  const hex1 = c1.startsWith('#') ? c1 : `#${c1}`
  const hex2 = c2.startsWith('#') ? c2 : `#${c2}`
  const rgb1 = hexToRgb(hex1)
  const rgb2 = hexToRgb(hex2)

  // After the image loads, redraw it through a canvas with duotone applied
  const apply = () => {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const c = canvas.getContext('2d')
    if (!c) return

    c.drawImage(img, 0, 0)
    const imageData = c.getImageData(0, 0, w, h)
    const data = imageData.data

    for (let i = 0; i < data.length; i += 4) {
      // Convert to grayscale using luminance weights
      const gray = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
      // Linearly interpolate between color1 (dark) and color2 (light)
      data[i] = Math.round(rgb1.r + (rgb2.r - rgb1.r) * gray)
      data[i + 1] = Math.round(rgb1.g + (rgb2.g - rgb1.g) * gray)
      data[i + 2] = Math.round(rgb1.b + (rgb2.b - rgb1.b) * gray)
      // Alpha channel (data[i+3]) is preserved
    }

    c.putImageData(imageData, 0, 0)
    img.src = canvas.toDataURL()
  }

  if (img.complete && img.naturalWidth) {
    apply()
  } else {
    img.addEventListener('load', apply, { once: true })
  }
}

// ---------------------------------------------------------------------------
// Luminance Effect
// ---------------------------------------------------------------------------

/**
 * Apply a luminance (brightness/contrast) effect to an image.
 *
 * OOXML `<a:lum>` supports `bright` (additive brightness offset, 0–100000 = 0–100%)
 * and `contrast` (multiplicative contrast, -100000 to 100000).
 * e.g. bright="100000" makes the entire image white (preserving alpha).
 */
function applyLumEffect(lum: SafeXmlNode, img: HTMLImageElement): void {
  const bright = (lum.numAttr('bright') ?? 0) / 100000 // 0–1
  const contrast = (lum.numAttr('contrast') ?? 0) / 100000 // -1 to 1

  if (bright === 0 && contrast === 0) return

  const apply = () => {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const c = canvas.getContext('2d')
    if (!c) return

    c.drawImage(img, 0, 0)
    const imageData = c.getImageData(0, 0, w, h)
    const data = imageData.data

    for (let i = 0; i < data.length; i += 4) {
      for (let ch = 0; ch < 3; ch++) {
        // Normalize to 0–1
        let v = data[i + ch] / 255
        // Apply contrast (expand/compress around 0.5)
        if (contrast !== 0) {
          v = 0.5 + (v - 0.5) * (1 + contrast)
        }
        // Apply additive brightness offset
        v += bright
        data[i + ch] = Math.round(Math.max(0, Math.min(255, v * 255)))
      }
      // Alpha preserved
    }

    c.putImageData(imageData, 0, 0)
    img.src = canvas.toDataURL()
  }

  if (img.complete && img.naturalWidth) {
    apply()
  } else {
    img.addEventListener('load', apply, { once: true })
  }
}

// ---------------------------------------------------------------------------
// BiLevel Effect
// ---------------------------------------------------------------------------

/**
 * Apply a bi-level (threshold) effect to an image.
 *
 * OOXML `<a:biLevel thresh="25000">` converts the image to black and white.
 * Each pixel's luminance is compared to the threshold (0–100000 = 0–100%).
 * Pixels above become white, pixels below become black. Alpha is preserved.
 */
function applyBiLevelEffect(biLevel: SafeXmlNode, img: HTMLImageElement): void {
  const thresh = (biLevel.numAttr('thresh') ?? 50000) / 100000 // 0–1

  const apply = () => {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const c = canvas.getContext('2d')
    if (!c) return

    c.drawImage(img, 0, 0)
    const imageData = c.getImageData(0, 0, w, h)
    const data = imageData.data

    for (let i = 0; i < data.length; i += 4) {
      const gray = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
      const val = gray >= thresh ? 255 : 0
      data[i] = val
      data[i + 1] = val
      data[i + 2] = val
      // Alpha preserved
    }

    c.putImageData(imageData, 0, 0)
    img.src = canvas.toDataURL()
  }

  if (img.complete && img.naturalWidth) {
    apply()
  } else {
    img.addEventListener('load', apply, { once: true })
  }
}
