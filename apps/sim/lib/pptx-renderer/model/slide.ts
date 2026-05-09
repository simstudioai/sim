/**
 * Slide parser — converts a slide XML into a structured SlideData
 * with typed node objects for each shape on the slide.
 */

import { type RelEntry, resolveRelTarget } from '../parser/rel-parser'
import { parseXml, type SafeXmlNode } from '../parser/xml-parser'
import { parseBaseProps } from './nodes/base-node'
import { type ChartNodeData, parseChartNode } from './nodes/chart-node'
import { type GroupNodeData, parseGroupNode } from './nodes/group-node'
import { type PicNodeData, parsePicNode } from './nodes/pic-node'
import { parseShapeNode, type ShapeNodeData } from './nodes/shape-node'
import { parseTableNode, type TableNodeData } from './nodes/table-node'

export type SlideNode = ShapeNodeData | PicNodeData | TableNodeData | GroupNodeData | ChartNodeData

export interface SlideData {
  index: number
  nodes: SlideNode[]
  background?: SafeXmlNode
  layoutIndex: string
  rels: Map<string, RelEntry>
  /** Full path to the slide file (e.g. "ppt/slides/slide3.xml"). */
  slidePath: string
  /** When false, shapes from the layout and master should NOT be rendered on this slide. */
  showMasterSp: boolean
}

/**
 * Check whether a graphicFrame contains a table (`a:tbl`).
 */
function isTableFrame(node: SafeXmlNode): boolean {
  const graphic = node.child('graphic')
  const graphicData = graphic.child('graphicData')
  return graphicData.child('tbl').exists()
}

/**
 * Check whether a graphicFrame contains a chart.
 */
function isChartFrame(node: SafeXmlNode): boolean {
  const graphic = node.child('graphic')
  const graphicData = graphic.child('graphicData')
  const uri = graphicData.attr('uri') || ''
  return uri.includes('chart')
}

/**
 * Find p:pic inside OLE graphicData (mc:AlternateContent > mc:Fallback or mc:Choice > p:oleObj > p:pic).
 * Returns the pic node if it has blipFill with embed (so we can render the preview image).
 */
function findOleFallbackPic(graphicFrame: SafeXmlNode): SafeXmlNode | null {
  const graphic = graphicFrame.child('graphic')
  const graphicData = graphic.child('graphicData')
  const uri = graphicData.attr('uri') || ''
  if (!uri.includes('ole')) return null

  const altContent = graphicData.child('AlternateContent')
  if (!altContent.exists()) return null

  for (const branch of ['Fallback', 'Choice'] as const) {
    const oleObj = altContent.child(branch).child('oleObj')
    if (!oleObj.exists()) continue
    const pic = oleObj.child('pic')
    if (!pic.exists()) continue
    const blipFill = pic.child('blipFill')
    const blip = blipFill.child('blip')
    const embed = blip.attr('embed') ?? blip.attr('r:embed')
    if (embed) return pic
  }
  return null
}

/**
 * Parse a graphicFrame that contains an OLE object with a fallback picture (preview image).
 * Uses the frame's position/size and the inner pic's blip embed.
 * Exported for use in GroupRenderer when parsing group children.
 */
export function parseOleFrameAsPicture(graphicFrame: SafeXmlNode): PicNodeData | undefined {
  const pic = findOleFallbackPic(graphicFrame)
  if (!pic) return undefined

  const base = parseBaseProps(graphicFrame)
  const blipFill = pic.child('blipFill')
  const blip = blipFill.child('blip')
  const blipEmbed = blip.attr('embed') ?? blip.attr('r:embed')
  const blipLink = blip.attr('link') ?? blip.attr('r:link')
  if (!blipEmbed) return undefined

  return {
    ...base,
    nodeType: 'picture',
    blipEmbed,
    blipLink,
    source: graphicFrame,
  }
}

/**
 * Check whether a graphicFrame contains a SmartArt diagram.
 */
function isDiagramFrame(node: SafeXmlNode): boolean {
  const graphic = node.child('graphic')
  const graphicData = graphic.child('graphicData')
  const uri = graphicData.attr('uri') || ''
  return uri.includes('diagram')
}

/**
 * Parse a SmartArt diagram graphicFrame by resolving the diagram drawing fallback XML.
 * The drawing XML contains pre-rendered shapes in a spTree that we can display as a group.
 */
function parseDiagramFrame(
  graphicFrame: SafeXmlNode,
  rels: Map<string, RelEntry>,
  slidePath: string,
  diagramDrawings: Map<string, string>
): GroupNodeData | undefined {
  const base = parseBaseProps(graphicFrame)
  const slideDir = slidePath.substring(0, slidePath.lastIndexOf('/'))
  const drawingCandidates = Array.from(rels.values())
    .filter(
      (entry) => entry.type.includes('diagramDrawing') || entry.target.includes('diagrams/drawing')
    )
    .map((entry) => {
      const target = entry.target
      const match = target.match(/drawing(\d+)/)
      return {
        target,
        num: match ? Number.parseInt(match[1], 10) : undefined,
      }
    })

  // Extract the diagram data rId from the relIds element to identify which diagram this is
  const graphic = graphicFrame.child('graphic')
  const graphicData = graphic.child('graphicData')
  const relIds = graphicData.child('relIds')

  // Strategy 1: Match data file number to drawing file number
  // e.g. data3.xml → drawing3.xml
  if (relIds.exists()) {
    const dmRId = relIds.attr('r:dm') ?? relIds.attr('dm')
    if (dmRId) {
      const dmRel = rels.get(dmRId)
      if (dmRel) {
        // Extract the number from the data target (e.g. "data3" → "3")
        const numMatch = dmRel.target.match(/data(\d+)/)
        if (numMatch) {
          const drawingNum = Number.parseInt(numMatch[1], 10)
          // Prefer exact drawingN; if absent, use the nearest numbered drawing relation.
          const ordered = drawingCandidates.slice().sort((a, b) => {
            const da = a.num === undefined ? Number.POSITIVE_INFINITY : Math.abs(a.num - drawingNum)
            const db = b.num === undefined ? Number.POSITIVE_INFINITY : Math.abs(b.num - drawingNum)
            return da - db
          })
          for (const candidate of ordered) {
            const drawingPath = resolveRelTarget(slideDir, candidate.target)
            const drawingXml = diagramDrawings.get(drawingPath)
            if (drawingXml) {
              return buildDiagramGroup(base, drawingXml)
            }
          }
        }
      }
    }
  }

  // Strategy 2: Fallback - find any diagramDrawing relationship
  for (const candidate of drawingCandidates) {
    const drawingPath = resolveRelTarget(slideDir, candidate.target)
    const drawingXml = diagramDrawings.get(drawingPath)
    if (drawingXml) {
      return buildDiagramGroup(base, drawingXml)
    }
  }

  return undefined
}

/**
 * Build a GroupNodeData from a diagram drawing XML string.
 * Diagram drawings use dsp: namespace (drawingml 2008); structure is dsp:drawing > dsp:spTree > dsp:sp.
 * Diagram shapes are positioned in the graphicFrame's own coordinate space.
 */
function buildDiagramGroup(
  base: ReturnType<typeof parseBaseProps>,
  drawingXml: string
): GroupNodeData {
  const drawingRoot = parseXml(drawingXml)
  const spTree = drawingRoot.child('spTree')
  if (!spTree.exists()) {
    return {
      ...base,
      nodeType: 'group',
      childOffset: { x: 0, y: 0 },
      childExtent: { w: base.size.w, h: base.size.h },
      children: [],
    }
  }

  const CHILD_TAGS = new Set(['sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp'])
  const children: SafeXmlNode[] = []

  for (const child of spTree.allChildren()) {
    if (CHILD_TAGS.has(child.localName)) {
      children.push(child)
    }
  }

  // Use the graphicFrame's own dimensions as the child coordinate space.
  // Diagram shapes are positioned in the frame's coordinate space (EMU converted to px).
  // Using frame dimensions gives a 1:1 scale, preserving original positions and sizes.
  // This avoids enlarging shapes when the bounding box is smaller than the frame.
  const extentW = Math.max(1, base.size.w)
  const extentH = Math.max(1, base.size.h)

  return {
    ...base,
    nodeType: 'group',
    childOffset: { x: 0, y: 0 },
    childExtent: { w: extentW, h: extentH },
    children,
  }
}

/**
 * Parse a single child node from spTree, dispatching to the appropriate parser.
 */
function parseChildNode(
  child: SafeXmlNode,
  rels: Map<string, RelEntry>,
  slidePath: string,
  diagramDrawings?: Map<string, string>
): SlideNode | undefined {
  const tag = child.localName

  switch (tag) {
    case 'sp':
    case 'cxnSp':
      return parseShapeNode(child)
    case 'pic':
      return parsePicNode(child)
    case 'grpSp':
      return parseGroupNode(child)
    case 'graphicFrame':
      if (isTableFrame(child)) {
        return parseTableNode(child)
      }
      if (isChartFrame(child)) {
        return parseChartNode(child, rels, slidePath)
      }
      // SmartArt diagram with drawing fallback
      if (isDiagramFrame(child) && diagramDrawings) {
        return parseDiagramFrame(child, rels, slidePath, diagramDrawings)
      }
      // OLE object with fallback picture (e.g. embedded PDF preview on slide 34)
      {
        const olePic = parseOleFrameAsPicture(child)
        if (olePic) return olePic
      }
      // Non-table/chart/ole graphic frames — skip
      return undefined
    default:
      return undefined
  }
}

/**
 * Find the layout relationship target from a slide's rels map.
 * The relationship type URI for slide layouts ends with "slideLayout".
 */
function findLayoutRel(rels: Map<string, RelEntry>): string {
  for (const [, entry] of rels) {
    if (entry.type.includes('slideLayout')) {
      return entry.target
    }
  }
  return ''
}

/**
 * Parse a slide XML root (`p:sld`) into SlideData.
 *
 * @param root      Parsed XML root of the slide
 * @param index     Zero-based slide index
 * @param rels      Relationship entries for this slide
 * @param slidePath Full path to the slide file (e.g. "ppt/slides/slide1.xml")
 */
export function parseSlide(
  root: SafeXmlNode,
  index: number,
  rels: Map<string, RelEntry>,
  slidePath = '',
  diagramDrawings?: Map<string, string>
): SlideData {
  const cSld = root.child('cSld')

  // --- Background ---
  const bg = cSld.child('bg')
  const background = bg.exists() ? bg : undefined

  // --- Parse shape tree children ---
  const spTree = cSld.child('spTree')
  const nodes: SlideNode[] = []

  for (const child of spTree.allChildren()) {
    const node = parseChildNode(child, rels, slidePath, diagramDrawings)
    if (node) {
      nodes.push(node)
    }
  }

  // --- Layout relationship ---
  const layoutIndex = findLayoutRel(rels)

  // --- showMasterSp: if "0", layout/master shapes should not be rendered on this slide ---
  const showMasterSpAttr = root.attr('showMasterSp')
  const showMasterSp = showMasterSpAttr !== '0'

  return {
    index,
    nodes,
    background,
    layoutIndex,
    rels,
    slidePath,
    showMasterSp,
  }
}
