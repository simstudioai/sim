/**
 * Group renderer — renders grouped shapes with coordinate space remapping.
 */

import type { BaseNodeData } from '../model/nodes/base-node'
import type { GroupNodeData } from '../model/nodes/group-node'
import type { ShapeNodeData } from '../model/nodes/shape-node'
import type { RenderContext } from './render-context'

// ---------------------------------------------------------------------------
// Group Rendering
// ---------------------------------------------------------------------------

/**
 * Render a group node into an absolutely-positioned HTML element.
 *
 * Groups define a child coordinate space (childOffset + childExtent) that must
 * be remapped to the group's actual position and size. Each child's position
 * and size are transformed accordingly before rendering.
 *
 * @param node       The parsed group node data
 * @param ctx        The render context
 * @param renderNode A callback to render individual child nodes (avoids circular deps)
 */
export function renderGroup(
  node: GroupNodeData,
  ctx: RenderContext,
  renderNode: (childNode: BaseNodeData, ctx: RenderContext) => HTMLElement
): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.position = 'absolute'
  wrapper.style.left = `${node.position.x}px`
  wrapper.style.top = `${node.position.y}px`
  wrapper.style.width = `${node.size.w}px`
  wrapper.style.height = `${node.size.h}px`

  // Apply rotation transform
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
    wrapper.style.transformOrigin = 'center center'
  }

  const chOff = node.childOffset
  const chExt = node.childExtent
  const groupW = node.size.w
  const groupH = node.size.h

  // Resolve group fill from grpSpPr for children that use a:grpFill
  const grpSpPr = node.source.child('grpSpPr')
  const childCtx: RenderContext = { ...ctx }
  if (grpSpPr.exists()) {
    // Check if the group itself has a fill (solidFill, gradFill, etc.)
    // that children can inherit via grpFill
    const FILL_TAGS = ['solidFill', 'gradFill', 'blipFill', 'pattFill']
    for (const tag of FILL_TAGS) {
      if (grpSpPr.child(tag).exists()) {
        childCtx.groupFillNode = grpSpPr
        break
      }
    }
    // If the group itself uses grpFill, propagate the parent's group fill
    if (!childCtx.groupFillNode && grpSpPr.child('grpFill').exists() && ctx.groupFillNode) {
      childCtx.groupFillNode = ctx.groupFillNode
    }
  }

  // Cycle diagram: 3 pie sectors + 3 circular arrows → one circle (3 equal 120° sectors) centered in the diagram.
  const parsedChildren = new Map<number, BaseNodeData | undefined>()
  const parseByIndex = (index: number): BaseNodeData | undefined => {
    if (!parsedChildren.has(index)) {
      parsedChildren.set(index, parseGroupChild(node.children[index], ctx))
    }
    return parsedChildren.get(index)
  }

  let pieCommon: { x: number; y: number; w: number; h: number } | null = null
  if (node.children.length === 6 && chExt.w > 0 && chExt.h > 0) {
    const prst = (c: (typeof node.children)[0]) => c.child('spPr').child('prstGeom').attr('prst')
    const firstPie = node.children.slice(0, 3).every((c) => prst(c) === 'pie')
    const nextArrow = node.children.slice(3, 6).every((c) => prst(c) === 'circularArrow')
    if (firstPie && nextArrow) {
      // Use diagram extent center and a single circle size so the circle is centered and fits.
      const pieNodes = [0, 1, 2].map((i) => parseByIndex(i)).filter(Boolean)
      if (pieNodes.length === 3) {
        const pieW = Math.max(...pieNodes.map((n) => n!.size.w))
        const pieH = Math.max(...pieNodes.map((n) => n!.size.h))
        const circleSize = Math.min(pieW, pieH, chExt.w, chExt.h)
        const centerX = chOff.x + chExt.w / 2
        const centerY = chOff.y + chExt.h / 2
        const left = centerX - circleSize / 2
        const top = centerY - circleSize / 2
        pieCommon = {
          x: ((left - chOff.x) / chExt.w) * groupW,
          y: ((top - chOff.y) / chExt.h) * groupH,
          w: (circleSize / chExt.w) * groupW,
          h: (circleSize / chExt.h) * groupH,
        }
      }
    }
  }

  // Cycle diagram: render arrows first (3,4,5) then pies (0,1,2) so blue sectors draw on top.
  const order = pieCommon ? [3, 4, 5, 0, 1, 2] : undefined
  const indices = order ?? node.children.map((_, i) => i)

  for (const index of indices) {
    try {
      const childNode = parseByIndex(index)
      if (!childNode) continue

      // Remap child coordinates from child space to group space
      if (chExt.w > 0 && chExt.h > 0) {
        childNode.position = {
          x: ((childNode.position.x - chOff.x) / chExt.w) * groupW,
          y: ((childNode.position.y - chOff.y) / chExt.h) * groupH,
        }
        childNode.size = {
          w: (childNode.size.w / chExt.w) * groupW,
          h: (childNode.size.h / chExt.h) * groupH,
        }
      }

      // Overlap the 3 pie sectors at the same center so they form one circle
      if (pieCommon && index < 3 && childNode.nodeType === 'shape') {
        const origW = childNode.size.w
        const origH = childNode.size.h
        childNode.position = { x: pieCommon.x, y: pieCommon.y }
        childNode.size = { w: pieCommon.w, h: pieCommon.h }
        // Scale text box so labels stay in the right sector (txXfrm was in original shape space)
        const shapeNode = childNode as ShapeNodeData
        if (origW > 0 && origH > 0 && shapeNode.textBoxBounds) {
          const tb = shapeNode.textBoxBounds
          shapeNode.textBoxBounds = {
            x: (tb.x / origW) * pieCommon.w,
            y: (tb.y / origH) * pieCommon.h,
            w: (tb.w / origW) * pieCommon.w,
            h: (tb.h / origH) * pieCommon.h,
          }
        }
      }

      const el = renderNode(childNode, childCtx)
      wrapper.appendChild(el)
    } catch {
      // Per-child error handling — create error placeholder
      const errDiv = document.createElement('div')
      errDiv.style.position = 'absolute'
      errDiv.style.border = '1px dashed #ff6b6b'
      errDiv.style.backgroundColor = 'rgba(255,107,107,0.1)'
      errDiv.style.fontSize = '10px'
      errDiv.style.color = '#cc0000'
      errDiv.style.display = 'flex'
      errDiv.style.alignItems = 'center'
      errDiv.style.justifyContent = 'center'
      errDiv.style.padding = '2px'
      errDiv.textContent = 'Group child error'
      wrapper.appendChild(errDiv)
    }
  }

  return wrapper
}

// ---------------------------------------------------------------------------
// Child Node Parsing
// ---------------------------------------------------------------------------

import { parseChartNode } from '../model/nodes/chart-node'
import { parseGroupNode } from '../model/nodes/group-node'
import { parsePicNode } from '../model/nodes/pic-node'
// Import parsers for child dispatch
import { parseShapeNode } from '../model/nodes/shape-node'
import { parseTableNode } from '../model/nodes/table-node'
import { parseOleFrameAsPicture } from '../model/slide'
import type { SafeXmlNode } from '../parser/xml-parser'

/**
 * Parse a raw XML child node from a group's spTree into a typed node object.
 * Returns undefined for unrecognized or unsupported elements.
 */
function parseGroupChild(childXml: SafeXmlNode, ctx: RenderContext): BaseNodeData | undefined {
  const tag = childXml.localName

  switch (tag) {
    case 'sp':
    case 'cxnSp':
      return parseShapeNode(childXml)
    case 'pic':
      return parsePicNode(childXml)
    case 'grpSp':
      return parseGroupNode(childXml)
    case 'graphicFrame': {
      const graphic = childXml.child('graphic')
      const graphicData = graphic.child('graphicData')
      if (graphicData.child('tbl').exists()) {
        return parseTableNode(childXml)
      }
      if ((graphicData.attr('uri') || '').includes('chart')) {
        return parseChartNode(childXml, ctx.slide.rels, ctx.slide.slidePath)
      }
      const olePic = parseOleFrameAsPicture(childXml)
      if (olePic) return olePic
      return undefined
    }
    default:
      return undefined
  }
}
