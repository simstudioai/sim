/**
 * Background renderer — resolves and applies slide/layout/master backgrounds.
 */

import type { RelEntry } from '../parser/rel-parser'
import type { SafeXmlNode } from '../parser/xml-parser'
import { hexToRgb } from '../utils/color'
import { getOrCreateBlobUrl, resolveMediaPath } from '../utils/media'
import type { RenderContext } from './render-context'
import { resolveColor, resolveFill } from './style-resolver'

const COLOR_NODE_NAMES = new Set([
  'srgbClr',
  'schemeClr',
  'sysClr',
  'prstClr',
  'hslClr',
  'scrgbClr',
])

/**
 * Check whether a node contains a supported OOXML color node.
 */
function hasColorNode(node: SafeXmlNode): boolean {
  if (COLOR_NODE_NAMES.has(node.localName)) {
    return true
  }

  return node.allChildren().some((child) => COLOR_NODE_NAMES.has(child.localName))
}

/**
 * Composite a semi-transparent color on white so the result is always opaque.
 * This prevents the slide background from becoming see-through when embedded
 * in containers with dark backgrounds (e.g. e2e-compare panels).
 */
function compositeOnWhite(r: number, g: number, b: number, a: number): string {
  const cr = Math.round(r * a + 255 * (1 - a))
  const cg = Math.round(g * a + 255 * (1 - a))
  const cb = Math.round(b * a + 255 * (1 - a))
  return `rgb(${cr},${cg},${cb})`
}

/**
 * Render the background for a slide onto the container element.
 *
 * Background priority: slide.background -> layout.background -> master.background.
 * The first found background is used.
 */
export function renderBackground(ctx: RenderContext, container: HTMLElement): void {
  // Find the first available background in the inheritance chain,
  // and track which rels map to use for resolving image references
  let bgNode: SafeXmlNode | undefined
  let bgRels: Map<string, RelEntry> = ctx.slide.rels

  if (ctx.slide.background) {
    bgNode = ctx.slide.background
    bgRels = ctx.slide.rels
  } else if (ctx.layout.background) {
    bgNode = ctx.layout.background
    bgRels = ctx.layout.rels
  } else if (ctx.master.background) {
    bgNode = ctx.master.background
    bgRels = ctx.master.rels
  }

  if (!bgNode) {
    container.style.backgroundColor = '#FFFFFF'
    return
  }

  // Parse p:bg > p:bgPr
  const bgPr = bgNode.child('bgPr')
  if (bgPr.exists()) {
    renderBgPr(bgPr, ctx, container, bgRels)
    return
  }

  // Parse p:bg > p:bgRef (theme reference)
  const bgRef = bgNode.child('bgRef')
  if (bgRef.exists()) {
    renderBgRef(bgRef, ctx, container)
    return
  }

  // Fallback
  container.style.backgroundColor = '#FFFFFF'
}

/**
 * Render background from bgPr (background properties).
 * Contains direct fill definitions: solidFill, gradFill, blipFill, etc.
 */
function renderBgPr(
  bgPr: SafeXmlNode,
  ctx: RenderContext,
  container: HTMLElement,
  rels?: Map<string, RelEntry>
): void {
  // solidFill
  const solidFill = bgPr.child('solidFill')
  if (solidFill.exists()) {
    const { color, alpha } = resolveColor(solidFill, ctx)
    const hex = color.startsWith('#') ? color : `#${color}`
    if (alpha < 1) {
      const { r, g, b } = hexToRgb(hex)
      container.style.backgroundColor = compositeOnWhite(r, g, b, alpha)
    } else {
      container.style.backgroundColor = hex
    }
    return
  }

  // gradFill
  const gradFill = bgPr.child('gradFill')
  if (gradFill.exists()) {
    const css = resolveFill(bgPr, ctx)
    if (css) {
      container.style.background = css
    }
    return
  }

  // blipFill (image background)
  const blipFill = bgPr.child('blipFill')
  if (blipFill.exists()) {
    renderBlipBackground(blipFill, ctx, container, rels)
    return
  }

  // noFill — still render as white; the slide is a self-contained element
  // and transparent backgrounds break when embedded in dark containers
  const noFill = bgPr.child('noFill')
  if (noFill.exists()) {
    container.style.backgroundColor = '#FFFFFF'
    return
  }
}

/**
 * Render background from bgRef (theme format scheme reference).
 * Simplified: just resolve the color from the reference.
 */
function renderBgRef(bgRef: SafeXmlNode, ctx: RenderContext, container: HTMLElement): void {
  // bgRef may contain a color child (schemeClr, srgbClr, etc.)
  if (!hasColorNode(bgRef)) {
    container.style.backgroundColor = '#FFFFFF'
    return
  }

  const { color, alpha } = resolveColor(bgRef, ctx)
  const hex = color.startsWith('#') ? color : `#${color}`
  if (alpha < 1) {
    const { r, g, b } = hexToRgb(hex)
    container.style.backgroundColor = compositeOnWhite(r, g, b, alpha)
  } else {
    container.style.backgroundColor = hex
  }
}

/**
 * Render a blip (image) fill as a CSS background.
 */
function renderBlipBackground(
  blipFill: SafeXmlNode,
  ctx: RenderContext,
  container: HTMLElement,
  rels?: Map<string, RelEntry>
): void {
  const blip = blipFill.child('blip')
  const embedId = blip.attr('embed') ?? blip.attr('r:embed')

  if (!embedId) return

  // Resolve image from rels + media (use provided rels or fall back to slide rels)
  const relsMap = rels ?? ctx.slide.rels
  const rel = relsMap.get(embedId)
  if (!rel) return

  const mediaPath = resolveMediaPath(rel.target)
  const data = ctx.presentation.media.get(mediaPath)
  if (!data) return

  const url = getOrCreateBlobUrl(mediaPath, data, ctx.mediaUrlCache)

  container.style.backgroundImage = `url("${url}")`

  // Check for stretch or tile mode
  const stretch = blipFill.child('stretch')
  if (stretch.exists()) {
    container.style.backgroundSize = 'cover'
    container.style.backgroundPosition = 'center'
    container.style.backgroundRepeat = 'no-repeat'

    // Parse fillRect for non-uniform stretch
    const fillRect = stretch.child('fillRect')
    if (fillRect.exists()) {
      // fillRect specifies insets — if all zero, it's a full stretch
      container.style.backgroundSize = '100% 100%'
    }
  }

  const tile = blipFill.child('tile')
  if (tile.exists()) {
    container.style.backgroundRepeat = 'repeat'
    container.style.backgroundSize = 'auto'
  }
}
