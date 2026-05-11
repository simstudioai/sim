/**
 * Shape renderer — converts ShapeNodeData into positioned HTML/SVG elements.
 */

import type { LineEndInfo, ShapeNodeData, TextBody } from '../model/nodes/shape-node'
import type { RenderContext } from './render-context'

/** True if the text body has at least one non-empty run (avoids covering shapes with empty placeholder text). */
function hasVisibleText(textBody: TextBody): boolean {
  for (const p of textBody.paragraphs) {
    for (const r of p.runs) {
      if (r.text != null && r.text.trim().length > 0) return true
    }
  }
  return false
}

import { emuToPx } from '../parser/units'
import type { SafeXmlNode } from '../parser/xml-parser'
import { renderCustomGeometry } from '../shapes/custom-geometry'
import {
  getActionButtonIconPath,
  getMultiPathPreset,
  getPresetShapePath,
  type PresetSubPath,
} from '../shapes/presets'
import { applyTint, hexToRgb, rgbToHex } from '../utils/color'
import { getOrCreateBlobUrl, resolveMediaPath } from '../utils/media'
import { isAllowedExternalUrl } from '../utils/url-safety'
import {
  resolveColor,
  resolveColorToCss,
  resolveFill,
  resolveGradientFill,
  resolveGradientStroke,
  resolveLineStyle,
  resolveThemeFillReference,
} from './style-resolver'
import { renderTextBody } from './text-renderer'

// ---------------------------------------------------------------------------
// Shape blipFill (image fill) — resolve to blob URL for reuse (e.g. SVG/PNG in process diagrams)
// ---------------------------------------------------------------------------

/** Resolve shape blipFill to a blob URL so we can render it (e.g. slide 23 process graphic). */
function resolveShapeBlipUrl(blipFill: SafeXmlNode, ctx: RenderContext): string | null {
  const blip = blipFill.child('blip')
  const embedId = blip.attr('embed') ?? blip.attr('r:embed')
  if (!embedId) return null
  const rel = ctx.slide.rels.get(embedId)
  if (!rel) return null
  const mediaPath = resolveMediaPath(rel.target)
  const data = ctx.presentation.media.get(mediaPath)
  if (!data) return null
  return getOrCreateBlobUrl(mediaPath, data, ctx.mediaUrlCache)
}

// ---------------------------------------------------------------------------
// Line End Marker (Arrowhead) Helpers
// ---------------------------------------------------------------------------

let markerIdCounter = 0
let gradientIdCounter = 0

function svgDashArrayForKind(dashKind: string, strokeWidth: number): string | null {
  const w = Math.max(strokeWidth, 1)
  switch (dashKind) {
    case 'dot':
    case 'sysDot':
      return `${w},${w * 2}`
    case 'dash':
    case 'sysDash':
      return `${w * 4},${w * 2}`
    case 'lgDash':
      return `${w * 8},${w * 3}`
    case 'dashDot':
    case 'sysDashDot':
      return `${w * 4},${w * 2},${w},${w * 2}`
    case 'lgDashDot':
      return `${w * 8},${w * 3},${w},${w * 3}`
    case 'lgDashDotDot':
    case 'sysDashDotDot':
      return `${w * 8},${w * 3},${w},${w * 2},${w},${w * 2}`
    default:
      return null
  }
}

function parseCssColorToRgb(color: string): { r: number; g: number; b: number } | null {
  if (!color) return null
  const hex = color.trim()
  if (hex.startsWith('#')) {
    return hexToRgb(hex)
  }
  const m = hex.match(/rgba?\(([^)]+)\)/i)
  if (!m) return null
  const parts = m[1].split(',').map((s) => Number.parseFloat(s.trim()))
  if (parts.length < 3 || parts.some((v) => Number.isNaN(v))) return null
  return {
    r: Math.max(0, Math.min(255, parts[0])),
    g: Math.max(0, Math.min(255, parts[1])),
    b: Math.max(0, Math.min(255, parts[2])),
  }
}

function mixRgb(
  base: { r: number; g: number; b: number },
  target: { r: number; g: number; b: number },
  t: number
): string {
  const k = Math.max(0, Math.min(1, t))
  return rgbToHex(
    base.r + (target.r - base.r) * k,
    base.g + (target.g - base.g) * k,
    base.b + (target.b - base.b) * k
  )
}

/**
 * Convert an OOXML gradient angle (in degrees, where 0 = right-to-left in OOXML coords)
 * to SVG linearGradient x1/y1/x2/y2 coordinates (as percentages).
 */
function angleToSvgGradientCoords(angleDeg: number): {
  x1: string
  y1: string
  x2: string
  y2: string
} {
  // OOXML: 0° = left-to-right, 90° = top-to-bottom (clockwise)
  // Convert to radians for trig
  const rad = (angleDeg * Math.PI) / 180
  // Calculate direction vector
  const x2 = Math.round(50 + 50 * Math.cos(rad))
  const y2 = Math.round(50 + 50 * Math.sin(rad))
  const x1 = Math.round(50 - 50 * Math.cos(rad))
  const y1 = Math.round(50 - 50 * Math.sin(rad))
  return {
    x1: `${x1}%`,
    y1: `${y1}%`,
    x2: `${x2}%`,
    y2: `${y2}%`,
  }
}

/**
 * Get the marker size multiplier based on OOXML size string.
 */
function getMarkerSize(size: string | undefined): number {
  switch (size) {
    case 'sm':
      return 0.5
    case 'lg':
      return 1.5
    default:
      return 1.0 // 'med' or undefined
  }
}

/**
 * Create an SVG marker element for a line end (arrowhead).
 */
function createArrowMarker(
  svgNs: string,
  info: LineEndInfo,
  strokeColor: string,
  strokeWidth: number,
  isHead: boolean
): SVGMarkerElement | null {
  const marker = document.createElementNS(svgNs, 'marker') as SVGMarkerElement
  const id = `arrow-marker-${++markerIdCounter}`
  marker.setAttribute('id', id)
  // Use userSpaceOnUse so markerWidth/Height are in SVG pixels directly.
  // This avoids the quadratic blow-up from markerUnits="strokeWidth" combined
  // with a base size that already factors in stroke width.
  marker.setAttribute('markerUnits', 'userSpaceOnUse')
  marker.setAttribute('orient', 'auto')

  const wMul = getMarkerSize(info.w)
  const lenMul = getMarkerSize(info.len)
  // Arrow size proportional to stroke width with balanced floor:
  // avoid tiny markers, but do not overgrow relative to line length.
  const baseLen = Math.max(strokeWidth * 4, 6.5)
  const baseW = Math.max(strokeWidth * 3.2, 5)
  const markerW = baseLen * lenMul
  const markerH = baseW * wMul

  switch (info.type) {
    case 'triangle':
    case 'arrow': {
      marker.setAttribute('viewBox', '0 0 10 10')
      // Anchor the arrow tip on the path endpoint so it does not intrude into target shapes.
      marker.setAttribute('refX', '10')
      marker.setAttribute('refY', '5')
      marker.setAttribute('markerWidth', String(markerW))
      marker.setAttribute('markerHeight', String(markerH))

      const polygon = document.createElementNS(svgNs, 'polygon')
      if (isHead) {
        // headEnd at marker-start: arrow points backward (-x / left)
        polygon.setAttribute('points', '0,5 10,0 10,10')
      } else {
        // tailEnd at marker-end: arrow points forward (+x / right)
        polygon.setAttribute('points', '10,5 0,0 0,10')
      }
      polygon.setAttribute('fill', strokeColor)
      marker.appendChild(polygon)
      break
    }
    case 'stealth': {
      marker.setAttribute('viewBox', '0 0 10 10')
      marker.setAttribute('refX', '10')
      marker.setAttribute('refY', '5')
      marker.setAttribute('markerWidth', String(markerW))
      marker.setAttribute('markerHeight', String(markerH))

      const path = document.createElementNS(svgNs, 'path')
      if (isHead) {
        // headEnd at marker-start: arrow points backward (-x / left)
        path.setAttribute('d', 'M0,5 L10,0 L7,5 L10,10 Z')
      } else {
        // tailEnd at marker-end: arrow points forward (+x / right)
        path.setAttribute('d', 'M10,5 L0,0 L3,5 L0,10 Z')
      }
      path.setAttribute('fill', strokeColor)
      marker.appendChild(path)
      break
    }
    case 'diamond': {
      marker.setAttribute('viewBox', '0 0 10 10')
      marker.setAttribute('refX', '5')
      marker.setAttribute('refY', '5')
      marker.setAttribute('markerWidth', String(markerW))
      marker.setAttribute('markerHeight', String(markerH))

      const diamond = document.createElementNS(svgNs, 'polygon')
      diamond.setAttribute('points', '5,0 10,5 5,10 0,5')
      diamond.setAttribute('fill', strokeColor)
      marker.appendChild(diamond)
      break
    }
    case 'oval': {
      marker.setAttribute('viewBox', '0 0 10 10')
      marker.setAttribute('refX', '5')
      marker.setAttribute('refY', '5')
      marker.setAttribute('markerWidth', String(markerW))
      marker.setAttribute('markerHeight', String(markerH))

      const circle = document.createElementNS(svgNs, 'circle')
      circle.setAttribute('cx', '5')
      circle.setAttribute('cy', '5')
      circle.setAttribute('r', '4')
      circle.setAttribute('fill', strokeColor)
      marker.appendChild(circle)
      break
    }
    default:
      return null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any

  ;(marker as any)._markerId = id
  return marker
}

/** Read headEnd/tailEnd from an OOXML a:ln node (e.g. theme line style). */
function getLineEndsFromLn(ln: SafeXmlNode): { headEnd?: LineEndInfo; tailEnd?: LineEndInfo } {
  const out: { headEnd?: LineEndInfo; tailEnd?: LineEndInfo } = {}
  const he = ln.child('headEnd')
  if (he.exists()) {
    const t = he.attr('type')
    if (t && t !== 'none') out.headEnd = { type: t, w: he.attr('w'), len: he.attr('len') }
  }
  const te = ln.child('tailEnd')
  if (te.exists()) {
    const t = te.attr('type')
    if (t && t !== 'none') out.tailEnd = { type: t, w: te.attr('w'), len: te.attr('len') }
  }
  return out
}

// ---------------------------------------------------------------------------
// Shape Rendering
// ---------------------------------------------------------------------------

/**
 * Render a shape node into an absolutely-positioned HTML element with SVG geometry.
 */
export function renderShape(node: ShapeNodeData, ctx: RenderContext): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.position = 'absolute'
  wrapper.style.left = `${node.position.x}px`
  wrapper.style.top = `${node.position.y}px`
  wrapper.style.width = `${node.size.w}px`
  // Line-like: preset line/connector, or cxnSp (connection shape), or flat extent (one dimension 0)
  const presetKey = node.presetGeometry?.toLowerCase() ?? ''
  const outlineOnlyPresets = new Set([
    'arc',
    'leftbracket',
    'rightbracket',
    'leftbrace',
    'rightbrace',
    'bracketpair',
    'bracepair',
  ])
  const presetIsLine =
    !!presetKey &&
    (presetKey === 'line' ||
      presetKey === 'lineinv' ||
      presetKey.includes('connector') ||
      outlineOnlyPresets.has(presetKey))
  const isConnectorShape = node.source.localName === 'cxnSp'
  const flatExtent =
    (node.size.w > 0 && node.size.h === 0) || (node.size.w === 0 && node.size.h > 0)
  const isLineLike = presetIsLine || isConnectorShape || flatExtent
  const minH = isLineLike && node.size.h === 0 ? 1 : node.size.h
  const minW = isLineLike && node.size.w === 0 ? 1 : node.size.w
  wrapper.style.height = `${minH}px`
  if (node.size.w === 0) wrapper.style.width = `${minW}px`
  wrapper.style.overflow = 'visible'
  // Apply transforms (rotation + flip)
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

  const w = node.size.w
  const h = node.size.h
  // For path generation, pass original w/h so preset functions can detect zero-extent
  // directions (e.g. line preset draws vertical when w=0, horizontal when h=0).
  // For SVG viewport, use minW/minH to guarantee a visible container.
  const pathW = w
  const pathH = h

  // Style references (needed for path fallback and line resolution)
  const styleNode = node.source.child('style')
  const lnRef = styleNode.exists() ? styleNode.child('lnRef') : undefined
  const fillRef = styleNode.exists() ? styleNode.child('fillRef') : undefined

  // ---- Generate SVG path ----
  let pathD = ''
  let multiPaths: PresetSubPath[] | null = null
  if (node.presetGeometry) {
    // For connector shapes (cxnSp), the 'line' preset should draw from start to end
    // point (0,0)→(w,h), not a horizontal midline. Use 'straightConnector1' instead,
    // which correctly handles diagonal/near-vertical connectors (e.g. cx≈0 but non-zero).
    let effectivePreset = node.presetGeometry
    if (isConnectorShape && effectivePreset === 'line') {
      effectivePreset = 'straightConnector1'
    }
    // Try multi-path preset first (complex shapes like scrolls with darkenLess paths)
    multiPaths = getMultiPathPreset(effectivePreset, pathW, pathH, node.adjustments)
    if (multiPaths) {
      // Use the first (main fill) path as pathD for backwards-compatible code paths
      pathD = multiPaths[0]?.d ?? ''
    } else {
      pathD = getPresetShapePath(effectivePreset, pathW, pathH, node.adjustments)
    }
  } else if (node.customGeometry) {
    const extNode = node.source.child('spPr').child('xfrm').child('ext')
    const sourceExtentEmu = {
      w: extNode.numAttr('cx') ?? 0,
      h: extNode.numAttr('cy') ?? 0,
    }
    pathD = renderCustomGeometry(node.customGeometry, pathW, pathH, sourceExtentEmu)
  }
  // Connectors (cxnSp) or flat-extent shapes with line style but no geometry: draw as line
  if (
    !pathD &&
    isLineLike &&
    (node.line?.exists() ||
      (lnRef?.exists() &&
        (lnRef.numAttr('idx') ?? 0) > 0 &&
        (ctx.theme.lineStyles?.length ?? 0) >= (lnRef.numAttr('idx') ?? 0)))
  ) {
    pathD = getPresetShapePath(
      isConnectorShape ? 'straightConnector1' : 'line',
      pathW,
      pathH,
      undefined
    )
  }

  // ---- Resolve fill and line styles ----
  const spPr = node.source.child('spPr')
  let fillCss = ''
  // Resolve structured gradient fill data (for SVG gradient elements)
  let gradientFillData = node.fill ? resolveGradientFill(spPr, ctx) : null
  if (node.fill?.exists()) {
    if (node.fill.localName === 'solidFill') {
      const colorChild = node.fill.child('srgbClr').exists()
        ? node.fill.child('srgbClr')
        : node.fill.child('schemeClr').exists()
          ? node.fill.child('schemeClr')
          : node.fill.child('scrgbClr').exists()
            ? node.fill.child('scrgbClr')
            : node.fill.child('sysClr').exists()
              ? node.fill.child('sysClr')
              : undefined
      if (colorChild?.exists()) fillCss = resolveColorToCss(colorChild, ctx)
    }
    if (!fillCss) fillCss = resolveFill(spPr, ctx)
  }
  // Diagram/SmartArt: read fill directly from source when still missing (spPr > solidFill > color)
  if (!fillCss) {
    const solidFill = spPr.child('solidFill')
    if (solidFill.exists()) {
      const colorChild = solidFill.child('srgbClr').exists()
        ? solidFill.child('srgbClr')
        : solidFill.child('schemeClr').exists()
          ? solidFill.child('schemeClr')
          : solidFill.child('scrgbClr').exists()
            ? solidFill.child('scrgbClr')
            : solidFill.child('sysClr').exists()
              ? solidFill.child('sysClr')
              : undefined
      if (colorChild?.exists()) fillCss = resolveColorToCss(colorChild, ctx)
    }
  }
  // fillRef fallback: when no explicit fill but fillRef idx > 0, use fillRef color
  if (!fillCss && fillRef && fillRef.exists()) {
    const resolvedThemeFill = resolveThemeFillReference(fillRef, ctx)
    fillCss = resolvedThemeFill.fillCss
    if (!gradientFillData) gradientFillData = resolvedThemeFill.gradientFillData
  }
  // Connectors and other line-like presets are stroke-only in OOXML. They may still
  // carry style fillRefs, but those must not become filled ribbons in SVG.
  if (isLineLike) {
    fillCss = ''
    gradientFillData = null
  }

  let strokeColor = 'none'
  let strokeWidth = 0
  let strokeDash = ''
  let strokeDashKind = 'solid'
  let strokeLinecap = ''
  let strokeLinejoin = ''
  let gradientStroke: ReturnType<typeof resolveGradientStroke> = null

  // Resolve effective line: explicit <a:ln> on shape, or use theme line from lnRef.
  // When line is explicitly <a:noFill/>, do not use lnRef — diagram arrows (e.g. circularArrow) must have no stroke.
  const lineIsNoFill = node.line?.child('noFill').exists()
  const hasExplicitLine = node.line && !lineIsNoFill
  const themeLineFromLnRef =
    !hasExplicitLine &&
    !lineIsNoFill &&
    lnRef?.exists() &&
    (lnRef.numAttr('idx') ?? 0) > 0 &&
    (ctx.theme.lineStyles?.length ?? 0) >= (lnRef.numAttr('idx') ?? 0)
      ? ctx.theme.lineStyles![(lnRef.numAttr('idx') ?? 1) - 1]
      : undefined
  let effectiveLine = hasExplicitLine ? node.line! : themeLineFromLnRef
  if (lineIsNoFill) effectiveLine = undefined

  if (effectiveLine?.exists()) {
    gradientStroke = resolveGradientStroke(effectiveLine, ctx)
    if (!gradientStroke) {
      const lineStyle = resolveLineStyle(effectiveLine, ctx, lnRef)
      strokeColor = lineStyle.color
      strokeWidth = lineStyle.width
      strokeDash = lineStyle.dash
      strokeDashKind = lineStyle.dashKind
    }

    // Line cap: a:ln@cap → SVG stroke-linecap
    const capAttr = effectiveLine.attr('cap')
    if (capAttr === 'rnd') strokeLinecap = 'round'
    else if (capAttr === 'sq') strokeLinecap = 'square'
    else if (capAttr === 'flat') strokeLinecap = 'butt'

    // Line join: from child elements
    if (effectiveLine.child('round').exists()) strokeLinejoin = 'round'
    else if (effectiveLine.child('bevel').exists()) strokeLinejoin = 'bevel'
    else if (effectiveLine.child('miter').exists()) strokeLinejoin = 'miter'
  }
  if (lineIsNoFill) {
    strokeColor = 'none'
    strokeWidth = 0
    gradientStroke = null
  }
  // SmartArt circularArrow must be fill-only (no stroke); preset-based override so diagram XML is not relied on.
  const isCircularArrow = node.presetGeometry?.toLowerCase() === 'circulararrow'
  if (isCircularArrow) {
    strokeColor = 'none'
    strokeWidth = 0
    gradientStroke = null
    if (!fillCss) {
      const solid = spPr.child('solidFill')
      if (solid.exists()) {
        const color = solid.child('srgbClr').exists()
          ? solid.child('srgbClr')
          : solid.child('schemeClr').exists()
            ? solid.child('schemeClr')
            : solid.child('scrgbClr').exists()
              ? solid.child('scrgbClr')
              : solid.child('sysClr').exists()
                ? solid.child('sysClr')
                : undefined
        if (color?.exists()) fillCss = resolveColorToCss(color, ctx)
      }
    }
  }

  // ---- Create SVG element ----
  if (pathD) {
    const svgNs = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(svgNs, 'svg')
    const svgW = isLineLike ? minW : w
    const svgH = isLineLike ? minH : h
    svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`)
    svg.setAttribute('width', String(svgW))
    svg.setAttribute('height', String(svgH))
    svg.style.position = 'absolute'
    svg.style.left = '0'
    svg.style.top = '0'
    svg.style.overflow = 'visible'

    const blipFill = spPr.child('blipFill')
    const blipUrl = blipFill.exists() ? resolveShapeBlipUrl(blipFill, ctx) : null

    // When shape has image fill (blipFill), render image clipped to path so complex graphics (e.g. slide 23 process) show
    if (blipUrl) {
      const defs = document.createElementNS(svgNs, 'defs')
      const clipId = `shape-clip-${++gradientIdCounter}`
      const clipPath = document.createElementNS(svgNs, 'clipPath')
      clipPath.setAttribute('id', clipId)
      const clipPathPath = document.createElementNS(svgNs, 'path')
      clipPathPath.setAttribute('d', pathD)
      clipPath.appendChild(clipPathPath)
      defs.appendChild(clipPath)
      const image = document.createElementNS(svgNs, 'image')
      image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', blipUrl)
      image.setAttribute('x', '0')
      image.setAttribute('y', '0')
      image.setAttribute('width', String(svgW))
      image.setAttribute('height', String(svgH))
      image.setAttribute('clip-path', `url(#${clipId})`)
      image.setAttribute('preserveAspectRatio', 'xMidYMid slice')
      svg.appendChild(defs)
      svg.appendChild(image)
      wrapper.appendChild(svg)
      // Skip path fill/stroke/markers — image replaces fill
    } else {
      // Create <defs> for gradients and markers
      const defs = document.createElementNS(svgNs, 'defs')

      const path = document.createElementNS(svgNs, 'path')
      path.setAttribute('d', pathD)
      const presetLower = node.presetGeometry?.toLowerCase()
      if (presetLower === 'curveduparrow' || presetLower === 'curveddownarrow') {
        // Curved arrows can contain overlapping sub-contours near arrowhead roots.
        // evenodd avoids tiny anti-alias seams that appear with nonzero winding.
        path.setAttribute('fill-rule', 'evenodd')
        path.setAttribute('stroke-linejoin', 'round')
      } else if (presetLower === 'funnel') {
        // Funnel has an inset ellipse sub-path that creates a "hole" (even-odd fill).
        path.setAttribute('fill-rule', 'evenodd')
      }

      // Fill
      if (fillCss) {
        if (gradientFillData && gradientFillData.stops.length > 0) {
          // Create SVG gradient definition for proper shape-clipped gradient fills
          const fillGradId = `grad-fill-${++gradientIdCounter}`

          if (gradientFillData.type === 'radial' && gradientFillData.pathType === 'rect') {
            // OOXML path="rect" gradient: Chebyshev distance (L∞ norm) creates
            // rectangular contour lines (the characteristic cross/X pattern).
            // SVG/CSS radial-gradient only supports elliptical contours.
            // Approximation: two linear gradients (H + V) blended with "lighten"
            // (per-channel max). max(dx, dy) = L∞ norm = rectangular contours.
            const gcx = gradientFillData.cx ?? 0.5
            const gcy = gradientFillData.cy ?? 0.5
            const stops = gradientFillData.stops

            // Mirror stops for center-out: original stop at N% → two stops at
            // (center - N%*distToEdge) and (center + N%*distToEdge) in gradient coords.
            const mirrorStops = (centerFrac: number) => {
              const mirrored: Array<{ offset: number; color: string }> = []
              for (const s of stops) {
                const t = s.position / 100 // 0..1 from center to edge
                const below = centerFrac - t * centerFrac
                const above = centerFrac + t * (1 - centerFrac)
                mirrored.push({ offset: below, color: s.color })
                mirrored.push({ offset: above, color: s.color })
              }
              mirrored.sort((a, b) => a.offset - b.offset)
              return mirrored
            }

            // Horizontal linear gradient (left → right, center at gcx)
            const hGradId = `${fillGradId}-h`
            const hGrad = document.createElementNS(svgNs, 'linearGradient')
            hGrad.setAttribute('id', hGradId)
            hGrad.setAttribute(
              'color-interpolation',
              gradientFillData.colorInterpolation ?? 'linearRGB'
            )
            hGrad.setAttribute('x1', '0%')
            hGrad.setAttribute('y1', '0%')
            hGrad.setAttribute('x2', '100%')
            hGrad.setAttribute('y2', '0%')
            for (const ms of mirrorStops(gcx)) {
              const svgStop = document.createElementNS(svgNs, 'stop')
              svgStop.setAttribute('offset', `${(ms.offset * 100).toFixed(2)}%`)
              svgStop.setAttribute('stop-color', ms.color)
              hGrad.appendChild(svgStop)
            }
            defs.appendChild(hGrad)

            // Vertical linear gradient (top → bottom, center at gcy)
            const vGradId = `${fillGradId}-v`
            const vGrad = document.createElementNS(svgNs, 'linearGradient')
            vGrad.setAttribute('id', vGradId)
            vGrad.setAttribute(
              'color-interpolation',
              gradientFillData.colorInterpolation ?? 'linearRGB'
            )
            vGrad.setAttribute('x1', '0%')
            vGrad.setAttribute('y1', '0%')
            vGrad.setAttribute('x2', '0%')
            vGrad.setAttribute('y2', '100%')
            for (const ms of mirrorStops(gcy)) {
              const svgStop = document.createElementNS(svgNs, 'stop')
              svgStop.setAttribute('offset', `${(ms.offset * 100).toFixed(2)}%`)
              svgStop.setAttribute('stop-color', ms.color)
              vGrad.appendChild(svgStop)
            }
            defs.appendChild(vGrad)

            // Use clipPath to constrain the blend group to the shape
            const clipId = `${fillGradId}-clip`
            const clipPath = document.createElementNS(svgNs, 'clipPath')
            clipPath.setAttribute('id', clipId)
            const clipUsePath = document.createElementNS(svgNs, 'path')
            clipUsePath.setAttribute('d', pathD)
            clipPath.appendChild(clipUsePath)
            defs.appendChild(clipPath)

            // Isolated group: black backdrop + two gradient layers with lighten blend.
            // lighten = per-channel max. Against black (0,0,0), first layer is identity.
            // Second layer's lighten against first = max(H, V) per channel.
            const blendGroup = document.createElementNS(svgNs, 'g')
            blendGroup.setAttribute('clip-path', `url(#${clipId})`)
            blendGroup.setAttribute('style', 'isolation: isolate')

            const bgRect = document.createElementNS(svgNs, 'rect')
            bgRect.setAttribute('width', '100%')
            bgRect.setAttribute('height', '100%')
            bgRect.setAttribute('fill', 'black')
            blendGroup.appendChild(bgRect)

            const hPath = document.createElementNS(svgNs, 'path')
            hPath.setAttribute('d', pathD)
            hPath.setAttribute('fill', `url(#${hGradId})`)
            hPath.setAttribute('style', 'mix-blend-mode: lighten')
            blendGroup.appendChild(hPath)

            const vPath = document.createElementNS(svgNs, 'path')
            vPath.setAttribute('d', pathD)
            vPath.setAttribute('fill', `url(#${vGradId})`)
            vPath.setAttribute('style', 'mix-blend-mode: lighten')
            blendGroup.appendChild(vPath)

            // Mark path as no-fill; the blend group handles it.
            // Tag the blend group so we can insert it before the main path later.
            path.setAttribute('fill', 'none')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(path as any).__rectBlendGroup = blendGroup
          } else if (gradientFillData.type === 'radial') {
            const radialGrad = document.createElementNS(svgNs, 'radialGradient')
            radialGrad.setAttribute('id', fillGradId)
            radialGrad.setAttribute(
              'color-interpolation',
              gradientFillData.colorInterpolation ?? 'linearRGB'
            )
            radialGrad.setAttribute('gradientUnits', 'userSpaceOnUse')
            const gcx = gradientFillData.cx ?? 0.5
            const gcy = gradientFillData.cy ?? 0.5
            radialGrad.setAttribute('cx', String(gcx * svgW))
            radialGrad.setAttribute('cy', String(gcy * svgH))
            // path="circle"/"shape": gradient reaches farthest corner
            const maxDx = Math.max(gcx, 1 - gcx)
            const maxDy = Math.max(gcy, 1 - gcy)
            const r = Math.sqrt(maxDx * maxDx + maxDy * maxDy)
            radialGrad.setAttribute('r', String(r * Math.max(svgW, svgH)))
            for (const stop of gradientFillData.stops) {
              const svgStop = document.createElementNS(svgNs, 'stop')
              svgStop.setAttribute('offset', `${stop.position}%`)
              svgStop.setAttribute('stop-color', stop.color)
              radialGrad.appendChild(svgStop)
            }
            defs.appendChild(radialGrad)
          } else {
            // Linear gradient
            const linearGrad = document.createElementNS(svgNs, 'linearGradient')
            linearGrad.setAttribute('id', fillGradId)
            linearGrad.setAttribute(
              'color-interpolation',
              gradientFillData.colorInterpolation ?? 'linearRGB'
            )
            linearGrad.setAttribute('gradientUnits', 'userSpaceOnUse')
            const coords = angleToSvgGradientCoords(gradientFillData.angle)
            linearGrad.setAttribute('x1', String((Number.parseFloat(coords.x1) / 100) * svgW))
            linearGrad.setAttribute('y1', String((Number.parseFloat(coords.y1) / 100) * svgH))
            linearGrad.setAttribute('x2', String((Number.parseFloat(coords.x2) / 100) * svgW))
            linearGrad.setAttribute('y2', String((Number.parseFloat(coords.y2) / 100) * svgH))
            for (const stop of gradientFillData.stops) {
              const svgStop = document.createElementNS(svgNs, 'stop')
              svgStop.setAttribute('offset', `${stop.position}%`)
              svgStop.setAttribute('stop-color', stop.color)
              linearGrad.appendChild(svgStop)
            }
            defs.appendChild(linearGrad)
          }

          // For rect blend group, fill was already handled (path set to 'none', blend group added).
          if (!(gradientFillData.type === 'radial' && gradientFillData.pathType === 'rect')) {
            path.setAttribute('fill', `url(#${fillGradId})`)
          }
        } else if (fillCss === 'transparent') {
          path.setAttribute('fill', 'none')
        } else if (fillCss.includes('gradient')) {
          // Fallback for gradients without structured data (shouldn't normally happen)
          // Apply to wrapper as before
          wrapper.style.background = fillCss
          path.setAttribute('fill', 'transparent')
        } else {
          path.setAttribute('fill', fillCss)
        }
      } else {
        path.setAttribute('fill', 'none')
      }
      // SmartArt circularArrow: force no stroke; fill already resolved via fillRef/solidFill above
      if (isCircularArrow) {
        // fillCss was already resolved (including fillRef fallback). Only override if still empty.
        if (!fillCss || fillCss === 'none' || fillCss === 'transparent') {
          // Try spPr > solidFill > color child as last resort
          const colorTags = ['srgbClr', 'schemeClr', 'scrgbClr', 'sysClr', 'hslClr', 'prstClr']
          let fallbackFill = ''
          const solid = spPr.child('solidFill')
          if (solid.exists()) {
            for (const child of solid.allChildren()) {
              if (colorTags.includes(child.localName)) {
                fallbackFill = resolveColorToCss(child, ctx)
                break
              }
            }
          }
          if (!fallbackFill && node.fill?.exists()) {
            for (const child of node.fill.allChildren()) {
              if (colorTags.includes(child.localName)) {
                fallbackFill = resolveColorToCss(child, ctx)
                break
              }
            }
          }
          if (fallbackFill) path.setAttribute('fill', fallbackFill)
        }
        path.setAttribute('stroke', 'none')
      }

      // Resolve arrow ends and effective stroke width before applying stroke (so we can enforce min width for connectors)
      let effectiveHeadEnd = node.headEnd
      let effectiveTailEnd = node.tailEnd
      if ((!effectiveHeadEnd || !effectiveTailEnd) && effectiveLine?.exists()) {
        const fromLn = getLineEndsFromLn(effectiveLine)
        if (!effectiveHeadEnd && fromLn.headEnd) effectiveHeadEnd = fromLn.headEnd
        if (!effectiveTailEnd && fromLn.tailEnd) effectiveTailEnd = fromLn.tailEnd
      }
      // For gradient strokes, use first stop for marker-start and last stop for marker-end
      // so arrowhead colours match the visible gradient end rather than always using the lightest stop.
      const gradStartColor = gradientStroke
        ? gradientStroke.stops[0]?.color || 'black'
        : strokeColor
      const gradEndColor = gradientStroke
        ? gradientStroke.stops[gradientStroke.stops.length - 1]?.color || gradStartColor
        : strokeColor
      let effectiveStrokeWidth = gradientStroke ? gradientStroke.width : strokeWidth
      if (isLineLike && (effectiveHeadEnd || effectiveTailEnd) && effectiveStrokeWidth <= 0) {
        effectiveStrokeWidth = 1 // so connector line and arrows both show (e.g. slide 24)
      }

      // Stroke — gradient stroke or solid stroke (skip for circularArrow; already set stroke=none above)
      // For multi-path presets where the first sub-path specifies stroke:false (e.g. callout1/2/3,
      // accentCallout1/2/3), suppress stroke on the main path element — the leader line and accent
      // bar are rendered as separate sub-path elements with their own stroke settings.
      const mainPathStrokeSuppressed = multiPaths && multiPaths[0]?.stroke === false
      if (
        !isCircularArrow &&
        !mainPathStrokeSuppressed &&
        gradientStroke &&
        gradientStroke.stops.length > 0
      ) {
        // Create SVG linearGradient for the gradient stroke.
        // Use userSpaceOnUse so the gradient is defined in SVG coordinate space rather
        // than objectBoundingBox. This is critical for straight line paths (zero-width or
        // zero-height bounding box) where objectBoundingBox produces degenerate coordinates
        // and the gradient becomes invisible.
        const gradId = `grad-stroke-${++gradientIdCounter}`
        const linearGrad = document.createElementNS(svgNs, 'linearGradient')
        linearGrad.setAttribute('id', gradId)
        linearGrad.setAttribute(
          'color-interpolation',
          gradientStroke.colorInterpolation ?? 'linearRGB'
        )
        linearGrad.setAttribute('gradientUnits', 'userSpaceOnUse')

        // Convert gradient angle to absolute coordinates in SVG user space
        const rad = (gradientStroke.angle * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        // Centre of the SVG viewBox
        const cx = svgW / 2
        const cy = svgH / 2
        // Half-extent along each axis (use max of both dimensions so the gradient covers the path)
        const halfLen = Math.max(svgW, svgH) / 2
        linearGrad.setAttribute('x1', String(cx - halfLen * cos))
        linearGrad.setAttribute('y1', String(cy - halfLen * sin))
        linearGrad.setAttribute('x2', String(cx + halfLen * cos))
        linearGrad.setAttribute('y2', String(cy + halfLen * sin))

        for (const stop of gradientStroke.stops) {
          const svgStop = document.createElementNS(svgNs, 'stop')
          svgStop.setAttribute('offset', `${stop.position}%`)
          svgStop.setAttribute('stop-color', stop.color)
          linearGrad.appendChild(svgStop)
        }

        defs.appendChild(linearGrad)

        const strokeW = Math.max(gradientStroke.width, 1)
        path.setAttribute('stroke', `url(#${gradId})`)
        path.setAttribute('stroke-width', String(strokeW))
        if (strokeLinecap) path.setAttribute('stroke-linecap', strokeLinecap)
        if (strokeLinejoin) path.setAttribute('stroke-linejoin', strokeLinejoin)
      } else if (
        !isCircularArrow &&
        !mainPathStrokeSuppressed &&
        effectiveStrokeWidth > 0 &&
        strokeColor !== 'transparent'
      ) {
        path.setAttribute('stroke', strokeColor)
        path.setAttribute('stroke-width', String(effectiveStrokeWidth))
        if (strokeLinecap) path.setAttribute('stroke-linecap', strokeLinecap)
        if (strokeLinejoin) path.setAttribute('stroke-linejoin', strokeLinejoin)
        const svgDashArray = svgDashArrayForKind(strokeDashKind, effectiveStrokeWidth)
        if (svgDashArray) {
          path.setAttribute('stroke-dasharray', svgDashArray)
        } else if (strokeDash === 'dashed') {
          path.setAttribute(
            'stroke-dasharray',
            `${effectiveStrokeWidth * 4},${effectiveStrokeWidth * 2}`
          )
        } else if (strokeDash === 'dotted') {
          path.setAttribute(
            'stroke-dasharray',
            `${effectiveStrokeWidth},${effectiveStrokeWidth * 2}`
          )
        }
      } else {
        path.setAttribute('stroke', 'none')
      }

      // Line end markers (arrowheads)
      // Use gradient start colour for head (marker-start) and end colour for tail (marker-end)
      if (effectiveStrokeWidth > 0 && (effectiveHeadEnd || effectiveTailEnd)) {
        if (effectiveHeadEnd) {
          const marker = createArrowMarker(
            svgNs,
            effectiveHeadEnd,
            gradStartColor,
            effectiveStrokeWidth,
            true
          )
          if (marker) {
            defs.appendChild(marker)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path.setAttribute('marker-start', `url(#${(marker as any)._markerId})`)
          }
        }

        if (effectiveTailEnd) {
          const marker = createArrowMarker(
            svgNs,
            effectiveTailEnd,
            gradEndColor,
            effectiveStrokeWidth,
            false
          )
          if (marker) {
            defs.appendChild(marker)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path.setAttribute('marker-end', `url(#${(marker as any)._markerId})`)
          }
        }
      }

      // Insert rect blend group (two linear gradients + lighten) before the main path
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((path as any).__rectBlendGroup) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svg.appendChild((path as any).__rectBlendGroup)(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          path as any
        ).__rectBlendGroup = undefined
      }

      svg.appendChild(path)

      // --- Multi-path preset rendering ---
      // For complex shapes (scrolls, etc.) that have multiple sub-paths with different
      // fill modifiers (darkenLess for shadow areas, none for stroke-only detail lines).
      if (multiPaths && multiPaths.length > 1) {
        const mainPathFill = path.getAttribute('fill') ?? ''
        const presetLower = node.presetGeometry?.toLowerCase() ?? ''
        const shadingBaseFill =
          mainPathFill && !mainPathFill.startsWith('url(')
            ? mainPathFill
            : fillRef?.exists()
              ? resolveColorToCss(fillRef, ctx)
              : (gradientFillData?.stops[0]?.color ?? fillCss)
        const baseRgb = parseCssColorToRgb(shadingBaseFill)
        const appendTintedGradientFill = (
          amount: number,
          target: { r: number; g: number; b: number }
        ): string | undefined => {
          if (gradientFillData?.type !== 'linear' || gradientFillData.stops.length === 0)
            return undefined
          const gradId = `grad-fill-detail-${++gradientIdCounter}`
          const linearGrad = document.createElementNS(svgNs, 'linearGradient')
          linearGrad.setAttribute('id', gradId)
          linearGrad.setAttribute('gradientUnits', 'userSpaceOnUse')
          linearGrad.setAttribute(
            'color-interpolation',
            gradientFillData.colorInterpolation ?? 'sRGB'
          )
          const coords = angleToSvgGradientCoords(gradientFillData.angle)
          linearGrad.setAttribute('x1', String((Number.parseFloat(coords.x1) / 100) * svgW))
          linearGrad.setAttribute('y1', String((Number.parseFloat(coords.y1) / 100) * svgH))
          linearGrad.setAttribute('x2', String((Number.parseFloat(coords.x2) / 100) * svgW))
          linearGrad.setAttribute('y2', String((Number.parseFloat(coords.y2) / 100) * svgH))
          for (const stop of gradientFillData.stops) {
            const svgStop = document.createElementNS(svgNs, 'stop')
            svgStop.setAttribute('offset', `${stop.position}%`)
            const stopRgb = parseCssColorToRgb(stop.color)
            svgStop.setAttribute(
              'stop-color',
              stopRgb ? mixRgb(stopRgb, target, amount) : stop.color
            )
            linearGrad.appendChild(svgStop)
          }
          defs.appendChild(linearGrad)
          return `url(#${gradId})`
        }
        // The first path was already rendered above as the main path.
        // Render additional sub-paths (darkenLess shadow, stroke-only detail lines).
        for (let pi = 1; pi < multiPaths.length; pi++) {
          const sp = multiPaths[pi]
          const extraPath = document.createElementNS(svgNs, 'path')
          extraPath.setAttribute('d', sp.d)
          if (sp.fill === 'none') {
            extraPath.setAttribute('fill', 'none')
          } else if (sp.fill === 'darkenLess') {
            extraPath.setAttribute(
              'fill',
              appendTintedGradientFill(0.15, { r: 0, g: 0, b: 0 }) ||
                (baseRgb ? mixRgb(baseRgb, { r: 0, g: 0, b: 0 }, 0.15) : 'rgba(0,0,0,0.15)')
            )
          } else if (sp.fill === 'darken') {
            extraPath.setAttribute(
              'fill',
              appendTintedGradientFill(0.3, { r: 0, g: 0, b: 0 }) ||
                (baseRgb ? mixRgb(baseRgb, { r: 0, g: 0, b: 0 }, 0.3) : 'rgba(0,0,0,0.3)')
            )
          } else if (sp.fill === 'lightenLess') {
            extraPath.setAttribute(
              'fill',
              appendTintedGradientFill(0.18, { r: 255, g: 255, b: 255 }) ||
                (baseRgb
                  ? mixRgb(baseRgb, { r: 255, g: 255, b: 255 }, 0.18)
                  : 'rgba(255,255,255,0.15)')
            )
          } else if (sp.fill === 'lighten') {
            let canHighlight: string | undefined
            if (
              presetLower === 'can' &&
              gradientFillData?.type === 'linear' &&
              gradientFillData.stops.length > 0
            ) {
              const faceGradId = `grad-fill-face-${++gradientIdCounter}`
              const faceGrad = document.createElementNS(svgNs, 'linearGradient')
              faceGrad.setAttribute('id', faceGradId)
              faceGrad.setAttribute('gradientUnits', 'userSpaceOnUse')
              faceGrad.setAttribute('color-interpolation', 'sRGB')
              const coords = angleToSvgGradientCoords(gradientFillData.angle)
              faceGrad.setAttribute('x1', String((Number.parseFloat(coords.x1) / 100) * svgW))
              faceGrad.setAttribute('y1', String((Number.parseFloat(coords.y1) / 100) * svgH))
              faceGrad.setAttribute('x2', String((Number.parseFloat(coords.x2) / 100) * svgW))
              faceGrad.setAttribute('y2', String((Number.parseFloat(coords.y2) / 100) * svgH))
              for (const stop of gradientFillData.stops) {
                const svgStop = document.createElementNS(svgNs, 'stop')
                svgStop.setAttribute('offset', `${stop.position}%`)
                svgStop.setAttribute('stop-color', applyTint(stop.color, 65000))
                faceGrad.appendChild(svgStop)
              }
              defs.appendChild(faceGrad)
              canHighlight = `url(#${faceGradId})`
            } else if (presetLower === 'can' && mainPathFill.startsWith('url(')) {
              canHighlight = mainPathFill
            }
            extraPath.setAttribute(
              'fill',
              canHighlight ||
                (baseRgb
                  ? mixRgb(baseRgb, { r: 255, g: 255, b: 255 }, 0.3)
                  : 'rgba(255,255,255,0.3)')
            )
          } else {
            // 'norm' — same fill as main path
            extraPath.setAttribute('fill', mainPathFill || 'none')
          }
          if (sp.stroke && effectiveStrokeWidth > 0 && strokeColor !== 'transparent') {
            extraPath.setAttribute('stroke', strokeColor)
            const isBorderCalloutLeader =
              node.presetGeometry?.toLowerCase() === 'bordercallout1' && sp.fill === 'none'
            const scaledStrokeWidth =
              sp.strokeWidthScale && Number.isFinite(sp.strokeWidthScale) && sp.strokeWidthScale > 0
                ? effectiveStrokeWidth * sp.strokeWidthScale
                : effectiveStrokeWidth
            const extraStrokeWidth = isBorderCalloutLeader
              ? Math.max(scaledStrokeWidth, 2.4)
              : scaledStrokeWidth
            extraPath.setAttribute('stroke-width', String(extraStrokeWidth))
            if (isBorderCalloutLeader) extraPath.setAttribute('stroke-linecap', 'round')
            if (
              sp.maskToMainOutlineBandScale &&
              sp.maskToMainOutlineBandScale > 0 &&
              sp.maskToMainOutlineBandScale < 1
            ) {
              const maskId = `shape-detail-band-mask-${++gradientIdCounter}`
              const mask = document.createElementNS(svgNs, 'mask')
              mask.setAttribute('id', maskId)
              mask.setAttribute('maskUnits', 'userSpaceOnUse')
              mask.setAttribute('maskContentUnits', 'userSpaceOnUse')
              const maskBg = document.createElementNS(svgNs, 'rect')
              maskBg.setAttribute('x', '0')
              maskBg.setAttribute('y', '0')
              maskBg.setAttribute('width', String(svgW))
              maskBg.setAttribute('height', String(svgH))
              maskBg.setAttribute('fill', 'black')
              mask.appendChild(maskBg)

              const outerPath = document.createElementNS(svgNs, 'path')
              outerPath.setAttribute('d', pathD)
              outerPath.setAttribute('fill', 'white')
              outerPath.setAttribute('stroke', 'none')
              mask.appendChild(outerPath)

              const insetScale = sp.maskToMainOutlineBandScale
              const insetPath = document.createElementNS(svgNs, 'path')
              insetPath.setAttribute('d', pathD)
              insetPath.setAttribute('fill', 'black')
              insetPath.setAttribute('stroke', 'none')
              const tx = (svgW * (1 - insetScale)) / 2
              const ty = (svgH * (1 - insetScale)) / 2
              insetPath.setAttribute('transform', `translate(${tx} ${ty}) scale(${insetScale})`)
              mask.appendChild(insetPath)

              defs.appendChild(mask)
              extraPath.setAttribute('mask', `url(#${maskId})`)
            } else if (sp.maskToMainOutline) {
              const maskId = `shape-detail-mask-${++gradientIdCounter}`
              const mask = document.createElementNS(svgNs, 'mask')
              mask.setAttribute('id', maskId)
              mask.setAttribute('maskUnits', 'userSpaceOnUse')
              mask.setAttribute('maskContentUnits', 'userSpaceOnUse')
              const maskBg = document.createElementNS(svgNs, 'rect')
              maskBg.setAttribute('x', '0')
              maskBg.setAttribute('y', '0')
              maskBg.setAttribute('width', String(svgW))
              maskBg.setAttribute('height', String(svgH))
              maskBg.setAttribute('fill', 'black')
              mask.appendChild(maskBg)
              const maskPath = document.createElementNS(svgNs, 'path')
              maskPath.setAttribute('d', pathD)
              maskPath.setAttribute('fill', 'none')
              maskPath.setAttribute('stroke', 'white')
              const maskStrokeWidth = Math.max(
                extraStrokeWidth *
                  (sp.maskStrokeScale && sp.maskStrokeScale > 0 ? sp.maskStrokeScale : 3),
                extraStrokeWidth
              )
              maskPath.setAttribute('stroke-width', String(maskStrokeWidth))
              maskPath.setAttribute('stroke-linecap', 'round')
              maskPath.setAttribute('stroke-linejoin', 'round')
              mask.appendChild(maskPath)
              defs.appendChild(mask)
              extraPath.setAttribute('mask', `url(#${maskId})`)
            }
          } else if (sp.stroke) {
            // Detail lines without explicit line style: avoid using identical fill color,
            // otherwise guide lines (e.g. chartX diagonals) become visually invisible.
            const detailStroke = baseRgb ? mixRgb(baseRgb, { r: 0, g: 0, b: 0 }, 0.55) : '#666666'
            extraPath.setAttribute('stroke', detailStroke)
            extraPath.setAttribute('stroke-width', '1')
          } else {
            extraPath.setAttribute('stroke', 'none')
          }
          svg.appendChild(extraPath)
        }
      }

      // Some multi-path detail rendering adds masks/gradients after the initial defs population.
      if (defs.children.length > 0 && !defs.parentNode) {
        svg.insertBefore(defs, svg.firstChild)
      }

      // circularArrow: ensure no stroke and remove markers
      if (isCircularArrow) {
        path.setAttribute('stroke', 'none')
        path.removeAttribute('stroke-width')
        path.removeAttribute('marker-start')
        path.removeAttribute('marker-end')
      }

      // --- Action button icon overlay (legacy fallback) ---
      // Only used for action buttons that don't have multiPathPresets entries.
      // Shapes with multiPathPresets already include the icon in their darken sub-paths.
      if (node.presetGeometry && !multiPaths) {
        const iconD = getActionButtonIconPath(node.presetGeometry, pathW, pathH)
        if (iconD) {
          const iconPath = document.createElementNS(svgNs, 'path')
          iconPath.setAttribute('d', iconD)
          // PowerPoint uses a darkened shade (~50%) of the fill colour for action button icons.
          let iconFill = '#333333'
          if (fillCss && fillCss !== 'transparent' && fillCss !== 'none') {
            const m = fillCss.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i)
            if (m) {
              const r = Number.parseInt(m[1], 16)
              const g = Number.parseInt(m[2], 16)
              const b = Number.parseInt(m[3], 16)
              // Shade at 50%: darken each channel by half
              iconFill = rgbToHex(Math.round(r * 0.5), Math.round(g * 0.5), Math.round(b * 0.5))
            }
          }
          iconPath.setAttribute('fill', iconFill)
          iconPath.setAttribute('stroke', 'none')
          svg.appendChild(iconPath)
        }
      }

      // (Can top ellipse overlay removed — now handled by multiPathPresets 'can' lighten sub-path)

      wrapper.appendChild(svg)
    }
  } else if (fillCss && fillCss !== 'transparent') {
    // No geometry but has fill — apply as background color
    if (fillCss.includes('gradient')) {
      wrapper.style.background = fillCss
    } else {
      wrapper.style.backgroundColor = fillCss
    }
  }

  // ---- Render text overlay (only when there is visible text; skip for decorative shapes with empty txBody) ----
  if (node.textBody && node.textBody.paragraphs.length > 0 && hasVisibleText(node.textBody)) {
    const textContainer = document.createElement('div')
    textContainer.style.position = 'absolute'
    if (node.textBoxBounds) {
      textContainer.style.left = `${node.textBoxBounds.x}px`
      textContainer.style.top = `${node.textBoxBounds.y}px`
      textContainer.style.width = `${node.textBoxBounds.w}px`
      textContainer.style.height = `${node.textBoxBounds.h}px`
    } else {
      textContainer.style.left = '0'
      textContainer.style.top = '0'
      textContainer.style.width = '100%'
      textContainer.style.height = '100%'
    }
    textContainer.style.display = 'flex'
    textContainer.style.flexDirection = 'column'
    textContainer.style.boxSizing = 'border-box'
    // Overflow handling based on bodyPr auto-fit mode:
    // - spAutoFit: shape resizes to fit text → overflow visible
    // - normAutofit: text shrinks to fit shape → apply fontScale, overflow hidden
    // - noAutofit: text clips → overflow hidden
    // - (default, no child): PowerPoint implicitly auto-shrinks → overflow visible
    const bodyPrForFit = node.textBody?.bodyProperties
    const hasSpAutoFit = bodyPrForFit?.child('spAutoFit').exists()
    const normAutofit = bodyPrForFit?.child('normAutofit')
    const hasNormAutofit = normAutofit?.exists()
    textContainer.style.overflowX = 'visible'
    // noAutofit means "don't auto-fit" — NOT "clip text". PowerPoint allows text to
    // overflow the shape boundary visibly.
    textContainer.style.overflowY = 'visible'

    // normAutofit: PowerPoint stores the computed fontScale (1000ths of percent).
    // Apply it as a CSS transform to shrink text so it fits the shape.
    let needsDynamicAutofit = false
    if (hasNormAutofit && normAutofit) {
      textContainer.style.overflowY = 'hidden'
      const fontScale = normAutofit.numAttr('fontScale')
      const lnSpcReduction = normAutofit.numAttr('lnSpcReduction') ?? 0
      if (fontScale != null && fontScale < 100000) {
        const scale = fontScale / 100000
        textContainer.style.transformOrigin = 'top left'
        textContainer.style.transform = `scale(${scale})`
        // Expand container dimensions so the scaled content fills the original space
        textContainer.style.width = `${100 / scale}%`
        textContainer.style.height = `${100 / scale}%`
      } else if (fontScale == null) {
        // fontScale not stored in XML — PowerPoint computes it at runtime.
        // We'll measure after DOM insertion and apply dynamic scaling.
        needsDynamicAutofit = true
      }
      if (lnSpcReduction > 0) {
        const lnFactor = 1 - lnSpcReduction / 100000
        textContainer.style.lineHeight = `${lnFactor}`
      }
    }
    // spAutoFit requests in-shape text fitting. In browser rendering we cannot
    // resize the absolutely positioned shape like PowerPoint editor behavior,
    // so use bounded dynamic scaling to prevent bleed across neighboring nodes.
    if (hasSpAutoFit && !hasNormAutofit) {
      textContainer.style.overflowY = 'hidden'
      needsDynamicAutofit = true
    }

    // Apply bodyPr (text body properties)
    // Use layout/master bodyPr as fallback for missing attributes
    {
      const bodyPr = node.textBody.bodyProperties
      const fallbackBp = node.textBody.layoutBodyProperties

      if (bodyPr) {
        // Text wrap: only wrap="none" should force single-line.
        // Title placeholders without explicit wrap should still be allowed to wrap.
        const wrap = bodyPr.attr('wrap') || (fallbackBp ? fallbackBp.attr('wrap') : null)
        if (wrap === 'none') {
          textContainer.style.whiteSpace = 'nowrap'
        }
      }

      // Vertical alignment (anchor): prefer shape's own, then layout placeholder
      const anchor =
        (bodyPr ? bodyPr.attr('anchor') : null) || (fallbackBp ? fallbackBp.attr('anchor') : null)
      if (anchor === 't') {
        textContainer.style.justifyContent = 'flex-start'
      } else if (anchor === 'ctr') {
        textContainer.style.justifyContent = 'center'
      } else if (anchor === 'b') {
        textContainer.style.justifyContent = 'flex-end'
      }

      // Internal margins (insets): prefer shape's own, then layout, then OOXML defaults
      const lIns =
        (bodyPr ? bodyPr.numAttr('lIns') : undefined) ??
        (fallbackBp ? fallbackBp.numAttr('lIns') : undefined)
      const tIns =
        (bodyPr ? bodyPr.numAttr('tIns') : undefined) ??
        (fallbackBp ? fallbackBp.numAttr('tIns') : undefined)
      const rIns =
        (bodyPr ? bodyPr.numAttr('rIns') : undefined) ??
        (fallbackBp ? fallbackBp.numAttr('rIns') : undefined)
      const bIns =
        (bodyPr ? bodyPr.numAttr('bIns') : undefined) ??
        (fallbackBp ? fallbackBp.numAttr('bIns') : undefined)

      // Default insets are 91440 EMU (0.1 inch) for L/R, 45720 EMU (0.05 inch) for T/B
      const leftPad = lIns !== undefined ? emuToPx(lIns) : emuToPx(91440)
      const topPad = tIns !== undefined ? emuToPx(tIns) : emuToPx(45720)
      const rightPad = rIns !== undefined ? emuToPx(rIns) : emuToPx(91440)
      const bottomPad = bIns !== undefined ? emuToPx(bIns) : emuToPx(45720)

      textContainer.style.paddingLeft = `${leftPad}px`
      textContainer.style.paddingTop = `${topPad}px`
      textContainer.style.paddingRight = `${rightPad}px`
      textContainer.style.paddingBottom = `${bottomPad}px`

      // Vertical text support (bodyPr@vert)
      const vert =
        (bodyPr ? bodyPr.attr('vert') : null) || (fallbackBp ? fallbackBp.attr('vert') : null)
      if (vert === 'eaVert') {
        textContainer.style.writingMode = 'vertical-rl'
      } else if (vert === 'vert' || vert === 'wordArtVert') {
        textContainer.style.writingMode = 'vertical-rl'
      } else if (vert === 'vert270') {
        textContainer.style.writingMode = 'vertical-rl'
        textContainer.style.transform = `${textContainer.style.transform || ''} rotate(180deg)`
      }
    }

    // Diagram text can carry its own txXfrm rotation; apply it inside the shape wrapper.
    if (node.textBoxBounds?.rotation && node.textBoxBounds.rotation !== 0) {
      const existing = textContainer.style.transform || ''
      textContainer.style.transform = `${existing} rotate(${node.textBoxBounds.rotation}deg)`.trim()
      textContainer.style.transformOrigin = 'center center'
    }

    // If text was flipped, un-flip the text so it reads correctly
    // Append to existing transforms (don't overwrite vert270 rotation)
    if (node.flipH || node.flipV) {
      const existing = textContainer.style.transform || ''
      const flipParts: string[] = []
      if (node.flipH) flipParts.push('scaleX(-1)')
      if (node.flipV) flipParts.push('scaleY(-1)')
      textContainer.style.transform = `${existing} ${flipParts.join(' ')}`.trim()
    }

    // Resolve fontRef color from shape style element (used by SmartArt diagram shapes
    // where text color is specified via dsp:style > a:fontRef > a:schemeClr).
    let fontRefColor: string | undefined
    const shapeStyle = node.source.child('style')
    if (shapeStyle.exists()) {
      const fontRef = shapeStyle.child('fontRef')
      if (fontRef.exists() && fontRef.allChildren().length > 0) {
        fontRefColor = resolveColorToCss(fontRef, ctx)
      }
    }

    renderTextBody(
      node.textBody,
      node.placeholder,
      ctx,
      textContainer,
      fontRefColor ? { fontRefColor } : undefined
    )
    wrapper.appendChild(textContainer)

    // Dynamic normAutofit: when fontScale is not stored in the XML, measure the
    // rendered text and compute the needed scale so all text fits the container.
    if (needsDynamicAutofit) {
      // The wrapper isn't in the DOM yet, so temporarily attach it offscreen to measure.
      wrapper.style.visibility = 'hidden'
      document.body.appendChild(wrapper)
      // Temporarily neutralise vertical alignment so content overflows downward
      // (flex-end would push content upward, making scrollHeight == clientHeight).
      const savedJC = textContainer.style.justifyContent
      textContainer.style.justifyContent = 'flex-start'
      const containerH = textContainer.clientHeight
      const contentH = textContainer.scrollHeight
      textContainer.style.justifyContent = savedJC
      document.body.removeChild(wrapper)
      wrapper.style.visibility = ''
      if (contentH > containerH && containerH > 0) {
        const scale = containerH / contentH
        textContainer.style.transformOrigin = 'top left'
        textContainer.style.transform = `scale(${scale})`
        textContainer.style.width = `${100 / scale}%`
        textContainer.style.height = `${100 / scale}%`
      }
    }
  }

  // ---- Effects (explicit effectLst or theme effectRef fallback) ----
  let effectiveEffectLst = spPr.child('effectLst')
  if (!effectiveEffectLst.exists()) {
    const effectRef = node.source.child('style').child('effectRef')
    const idx = effectRef.numAttr('idx') ?? 0
    if (idx > 0 && (ctx.theme.effectStyles?.length ?? 0) >= idx) {
      const themeEffect = ctx.theme.effectStyles[idx - 1]
      if (themeEffect.exists()) {
        const lst = themeEffect.child('effectLst')
        if (lst.exists()) effectiveEffectLst = lst
      }
    }
  }

  if (effectiveEffectLst.exists()) {
    const outerShdw = effectiveEffectLst.child('outerShdw')
    if (outerShdw.exists()) {
      const dir = outerShdw.numAttr('dir') ?? 0 // direction in 60000ths of degree
      const dist = outerShdw.numAttr('dist') ?? 0 // distance in EMU
      const blurRad = outerShdw.numAttr('blurRad') ?? 0 // blur radius in EMU
      const sx = outerShdw.numAttr('sx') // horizontal scale (100000 = 100%)
      const sy = outerShdw.numAttr('sy') // vertical scale (100000 = 100%)
      const algn = outerShdw.attr('algn') // alignment anchor (t, b, tl, tr, etc.)

      const dirDeg = dir / 60000
      const distPx = emuToPx(dist)
      const blurPx = emuToPx(blurRad)
      const offsetX = distPx * Math.cos((dirDeg * Math.PI) / 180)
      const offsetY = distPx * Math.sin((dirDeg * Math.PI) / 180)

      // Resolve shadow color
      let shadowColor = 'rgba(0,0,0,0.4)'
      const { color: shdColor, alpha: shdAlpha } = resolveColor(outerShdw, ctx)
      if (shdColor) {
        const hex = shdColor.startsWith('#') ? shdColor : `#${shdColor}`
        const { r: sr, g: sg, b: sb } = hexToRgb(hex)
        shadowColor = `rgba(${sr},${sg},${sb},${shdAlpha.toFixed(3)})`
      }

      // PowerPoint outerShdw with sx/sy creates a scaled shadow copy, then draws the
      // shape on top.  When dist=0 and scale ≈ 100%, only the thin edge overhang is
      // visible – far subtler than a CSS drop-shadow with the full blur radius.
      // Approximate with box-shadow using spread derived from scale and reduced blur.
      if (sx != null && sy != null && sx > 0 && sy > 0) {
        const scaleX = sx / 100000
        const scaleY = sy / 100000
        const shapeW = node.size?.w ?? 100
        const shapeH = node.size?.h ?? 100

        // For line-like shapes, sx/sy should scale line thickness, not full line length.
        // Using shape width here can explode spread on long connectors (slide 68 regression).
        let spreadBasisW = shapeW
        let spreadBasisH = shapeH
        if (isLineLike || shapeW <= 1 || shapeH <= 1) {
          const lineWEmu = node.line?.numAttr('w') ?? 12700
          const lineThickness = Math.max(1, emuToPx(lineWEmu))
          spreadBasisW = lineThickness
          spreadBasisH = lineThickness
        }

        // Spread = how far the shadow extends beyond the shape on each side
        const spreadX = (spreadBasisW * (scaleX - 1)) / 2
        const spreadY = (spreadBasisH * (scaleY - 1)) / 2
        const spread = Math.max(0, (spreadX + spreadY) / 2)

        // Alignment shifts the shadow anchor point; compute extra offset
        let alignOffX = 0
        let alignOffY = 0
        if (algn) {
          // OOXML algn is an enum (t, b, l, r, tl, tr, bl, br, ctr), not a substring bag.
          // Exact matching avoids misinterpreting "ctr" as containing both "t" and "r".
          const a = algn.toLowerCase()
          if (a === 't' || a === 'tl' || a === 'tr') alignOffY = (spreadBasisH * (scaleY - 1)) / 2
          if (a === 'b' || a === 'bl' || a === 'br') alignOffY = (-spreadBasisH * (scaleY - 1)) / 2
          if (a === 'l' || a === 'tl' || a === 'bl') alignOffX = (spreadBasisW * (scaleX - 1)) / 2
          if (a === 'r' || a === 'tr' || a === 'br') alignOffX = (-spreadBasisW * (scaleX - 1)) / 2
        }

        // When spread is tiny relative to blurPx, PowerPoint's Gaussian blur
        // distributes energy across the full blur area.  The visible edge (only
        // `spread` wide) receives only a fraction of the original alpha.
        // Attenuate alpha accordingly so thin-edge shadows are nearly invisible.
        const effectiveBlur = Math.min(blurPx, spread * 3)
        let effectiveAlpha = shdAlpha
        if (blurPx > 0 && spread < blurPx) {
          effectiveAlpha = shdAlpha * (spread / blurPx)
        }

        // Skip shadow entirely if effective alpha is negligible
        if (effectiveAlpha >= 0.01) {
          const bsX = (offsetX + alignOffX).toFixed(1)
          const bsY = (offsetY + alignOffY).toFixed(1)
          // Recompute shadow color with attenuated alpha
          let attenuatedColor = shadowColor
          if (shdColor) {
            const hex2 = shdColor.startsWith('#') ? shdColor : `#${shdColor}`
            const { r: sr2, g: sg2, b: sb2 } = hexToRgb(hex2)
            attenuatedColor = `rgba(${sr2},${sg2},${sb2},${effectiveAlpha.toFixed(4)})`
          }
          wrapper.style.boxShadow = `${bsX}px ${bsY}px ${effectiveBlur.toFixed(1)}px ${spread.toFixed(1)}px ${attenuatedColor}`
        }
      } else {
        wrapper.style.filter = `drop-shadow(${offsetX.toFixed(1)}px ${offsetY.toFixed(1)}px ${blurPx.toFixed(1)}px ${shadowColor})`
      }
    }

    // Reflection is not directly representable in standard CSS across browsers.
    // Approximate via -webkit-box-reflect when available (Chromium/WebKit).
    const reflection = effectiveEffectLst.child('reflection')
    if (reflection.exists()) {
      const dist = emuToPx(reflection.numAttr('dist') ?? 0)
      const stA = (reflection.numAttr('stA') ?? 50000) / 100000
      const endA = (reflection.numAttr('endA') ?? 0) / 100000
      const stPos = Math.max(0, Math.min(100, (reflection.numAttr('stPos') ?? 0) / 1000))
      const endPos = Math.max(0, Math.min(100, (reflection.numAttr('endPos') ?? 100000) / 1000))
      const mask = `linear-gradient(to bottom, rgba(255,255,255,${stA.toFixed(3)}) ${stPos.toFixed(1)}%, rgba(255,255,255,${endA.toFixed(3)}) ${endPos.toFixed(1)}%)`
      const reflectValue = `below ${dist.toFixed(1)}px ${mask}`
      wrapper.style.setProperty('-webkit-box-reflect', reflectValue)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(wrapper.style as any).webkitBoxReflect = reflectValue
    }
  }

  // ---- Shape-level hyperlink / action button navigation ----
  if (node.hlinkClick && ctx.onNavigate) {
    const { action, rId } = node.hlinkClick
    if (action === 'ppaction://hlinksldjump' && rId) {
      // Resolve slide target from relationship
      const rel = ctx.slide.rels.get(rId)
      if (rel) {
        // Target is like "slide28.xml" → slide index 27 (0-based)
        const match = rel.target.match(/slide(\d+)\.xml/)
        if (match) {
          const slideIndex = Number.parseInt(match[1], 10) - 1
          wrapper.style.cursor = 'pointer'
          wrapper.title = node.hlinkClick.tooltip || `Go to slide ${slideIndex + 1}`
          wrapper.addEventListener('click', (e) => {
            e.stopPropagation()
            ctx.onNavigate!({ slideIndex })
          })
        }
      }
    } else if (rId) {
      // External URL link
      const rel = ctx.slide.rels.get(rId)
      if (rel && rel.targetMode === 'External' && isAllowedExternalUrl(rel.target)) {
        wrapper.style.cursor = 'pointer'
        wrapper.title = node.hlinkClick.tooltip || rel.target
        wrapper.addEventListener('click', (e) => {
          e.stopPropagation()
          ctx.onNavigate!({ url: rel.target })
        })
      }
    }
  }

  return wrapper
}
