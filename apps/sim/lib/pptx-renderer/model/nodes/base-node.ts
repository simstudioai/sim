/**
 * Base node types and property parser shared by all slide node kinds.
 */

import { angleToDeg, emuToPx } from '../../parser/units'
import type { SafeXmlNode } from '../../parser/xml-parser'

export type NodeType = 'shape' | 'picture' | 'table' | 'group' | 'chart' | 'unknown'

export interface Position {
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

export interface PlaceholderInfo {
  type?: string
  idx?: number
}

/** Shape-level hyperlink click action (from cNvPr > a:hlinkClick). */
export interface HlinkAction {
  /** Action URI, e.g. "ppaction://hlinksldjump", "ppaction://hlinkpres", or empty for URL links. */
  action?: string
  /** Relationship ID for the target (slide, URL, etc.). */
  rId?: string
  /** Optional tooltip text. */
  tooltip?: string
}

export interface BaseNodeData {
  id: string
  name: string
  nodeType: NodeType
  position: Position
  size: Size
  rotation: number
  flipH: boolean
  flipV: boolean
  placeholder?: PlaceholderInfo
  /** Shape-level hyperlink/click action (action buttons, clickable shapes). */
  hlinkClick?: HlinkAction
  /** @internal Raw XML node — opaque to consumers. Use serializePresentation() for JSON-safe data. */
  source: SafeXmlNode
}

/**
 * Try to find the non-visual properties container in the given node.
 * PPTX uses different wrapper names depending on the shape kind:
 *   p:nvSpPr (shapes/connectors), p:nvPicPr (pictures),
 *   p:nvGrpSpPr (groups), p:nvGraphicFramePr (tables/charts).
 */
function findNvProps(node: SafeXmlNode): { cNvPr: SafeXmlNode; nvPr: SafeXmlNode } {
  const wrappers = ['nvSpPr', 'nvPicPr', 'nvGrpSpPr', 'nvGraphicFramePr', 'nvCxnSpPr']
  for (const name of wrappers) {
    const wrapper = node.child(name)
    if (wrapper.exists()) {
      return {
        cNvPr: wrapper.child('cNvPr'),
        nvPr: wrapper.child('nvPr'),
      }
    }
  }
  return {
    cNvPr: node.child('cNvPr'),
    nvPr: node.child('nvPr'),
  }
}

/**
 * Find the transform (xfrm) node. Shapes use `p:spPr > a:xfrm`,
 * groups use `p:grpSpPr > a:xfrm`, graphic frames use `p:xfrm`.
 */
function findXfrm(node: SafeXmlNode): SafeXmlNode {
  // Try spPr first (most shapes)
  const spPr = node.child('spPr')
  if (spPr.exists()) {
    const xfrm = spPr.child('xfrm')
    if (xfrm.exists()) return xfrm
  }

  // Try grpSpPr (groups)
  const grpSpPr = node.child('grpSpPr')
  if (grpSpPr.exists()) {
    const xfrm = grpSpPr.child('xfrm')
    if (xfrm.exists()) return xfrm
  }

  // Try direct xfrm (graphic frames)
  const directXfrm = node.child('xfrm')
  if (directXfrm.exists()) return directXfrm

  // Return empty node — all reads will return defaults
  return node.child('__nonexistent__')
}

/**
 * Parse placeholder info from nvPr > p:ph.
 */
function parsePlaceholder(nvPr: SafeXmlNode): PlaceholderInfo | undefined {
  const ph = nvPr.child('ph')
  if (!ph.exists()) return undefined

  const type = ph.attr('type')
  const idx = ph.numAttr('idx')

  return { type, idx }
}

/**
 * Parse the base properties common to all node types from a shape-like XML node.
 * Returns everything except `nodeType`, which the caller must set.
 */
export function parseBaseProps(spNode: SafeXmlNode): Omit<BaseNodeData, 'nodeType'> {
  const { cNvPr, nvPr } = findNvProps(spNode)

  const id = cNvPr.attr('id') ?? ''
  const name = cNvPr.attr('name') ?? ''

  // --- Transform ---
  const xfrm = findXfrm(spNode)
  const off = xfrm.child('off')
  const ext = xfrm.child('ext')

  const position: Position = {
    x: emuToPx(off.numAttr('x') ?? 0),
    y: emuToPx(off.numAttr('y') ?? 0),
  }

  const size: Size = {
    w: emuToPx(ext.numAttr('cx') ?? 0),
    h: emuToPx(ext.numAttr('cy') ?? 0),
  }

  const rotation = angleToDeg(xfrm.numAttr('rot') ?? 0)
  const flipH = xfrm.attr('flipH') === '1' || xfrm.attr('flipH') === 'true'
  const flipV = xfrm.attr('flipV') === '1' || xfrm.attr('flipV') === 'true'

  // --- Placeholder ---
  const placeholder = parsePlaceholder(nvPr)

  // --- Shape-level hyperlink action (cNvPr > a:hlinkClick) ---
  let hlinkClick: HlinkAction | undefined
  const hlinkNode = cNvPr.child('hlinkClick')
  if (hlinkNode.exists()) {
    hlinkClick = {
      action: hlinkNode.attr('action') ?? undefined,
      rId: hlinkNode.attr('id') ?? hlinkNode.attr('r:id') ?? undefined,
      tooltip: hlinkNode.attr('tooltip') ?? undefined,
    }
  }

  return {
    id,
    name,
    position,
    size,
    rotation,
    flipH,
    flipV,
    placeholder,
    hlinkClick,
    source: spNode,
  }
}
