/**
 * Shape node parser — handles auto-shapes, text boxes, and connectors.
 */

import { angleToDeg, emuToPx } from '../../parser/units'
import type { SafeXmlNode } from '../../parser/xml-parser'
import { type BaseNodeData, parseBaseProps } from './base-node'

interface TextRun {
  text: string
  /** @internal Raw XML node — opaque to consumers. Use serializePresentation() for JSON-safe data. */
  properties?: SafeXmlNode
}

interface TextParagraph {
  /** @internal Raw XML node — opaque to consumers. Use serializePresentation() for JSON-safe data. */
  properties?: SafeXmlNode
  runs: TextRun[]
  level: number
  /** @internal End-of-paragraph run properties (a:endParaRPr). Defines font size for trailing paragraph mark. */
  endParaRPr?: SafeXmlNode
}

export interface TextBody {
  /** @internal Raw XML node — opaque to consumers. Use serializePresentation() for JSON-safe data. */
  bodyProperties?: SafeXmlNode
  /** @internal Fallback bodyPr from layout/master placeholder (used when shape's own bodyPr is missing attrs). */
  layoutBodyProperties?: SafeXmlNode
  /** @internal Raw XML node — opaque to consumers. Use serializePresentation() for JSON-safe data. */
  listStyle?: SafeXmlNode
  paragraphs: TextParagraph[]
}

export interface LineEndInfo {
  type: string // 'triangle', 'arrow', 'stealth', 'diamond', 'oval', 'none'
  w?: string // 'sm', 'med', 'lg'
  len?: string // 'sm', 'med', 'lg'
}

/** Text box bounds in shape-local coordinates (used by diagram shapes with txXfrm). */
interface TextBoxBounds {
  x: number
  y: number
  w: number
  h: number
  rotation?: number
}

export interface ShapeNodeData extends BaseNodeData {
  nodeType: 'shape'
  presetGeometry?: string
  adjustments: Map<string, number>
  /** @internal Raw XML node — opaque to consumers. Use serializePresentation() for JSON-safe data. */
  customGeometry?: SafeXmlNode
  /** @internal Raw XML node — opaque to consumers. Use serializePresentation() for JSON-safe data. */
  fill?: SafeXmlNode
  /** @internal Raw XML node — opaque to consumers. Use serializePresentation() for JSON-safe data. */
  line?: SafeXmlNode
  headEnd?: LineEndInfo
  tailEnd?: LineEndInfo
  textBody?: TextBody
  /** When set (e.g. diagram txXfrm), text is laid out in this rect instead of full shape. */
  textBoxBounds?: TextBoxBounds
}

/**
 * Parse a single text paragraph (`a:p`).
 */
function parseParagraph(pNode: SafeXmlNode): TextParagraph {
  const pPr = pNode.child('pPr')
  const level = pPr.numAttr('lvl') ?? 0

  // Re-scan in document order to get correct interleaving of r, br, fld
  const orderedRuns: TextRun[] = []
  for (const child of pNode.allChildren()) {
    const ln = child.localName
    if (ln === 'r') {
      const rPr = child.child('rPr')
      const tNode = child.child('t')
      orderedRuns.push({
        text: tNode.text(),
        properties: rPr.exists() ? rPr : undefined,
      })
    } else if (ln === 'br') {
      const rPr = child.child('rPr')
      orderedRuns.push({
        text: '\n',
        properties: rPr.exists() ? rPr : undefined,
      })
    } else if (ln === 'fld') {
      const rPr = child.child('rPr')
      const tNode = child.child('t')
      orderedRuns.push({
        text: tNode.text(),
        properties: rPr.exists() ? rPr : undefined,
      })
    }
  }

  const endParaRPrNode = pNode.child('endParaRPr')
  return {
    properties: pPr.exists() ? pPr : undefined,
    runs: orderedRuns,
    level,
    endParaRPr: endParaRPrNode.exists() ? endParaRPrNode : undefined,
  }
}

/**
 * Parse a text body (`p:txBody` or `a:txBody`).
 */
export function parseTextBody(txBody: SafeXmlNode): TextBody | undefined {
  if (!txBody.exists()) return undefined

  const bodyPr = txBody.child('bodyPr')
  const lstStyle = txBody.child('lstStyle')

  const paragraphs: TextParagraph[] = []
  for (const pNode of txBody.children('p')) {
    paragraphs.push(parseParagraph(pNode))
  }

  return {
    bodyProperties: bodyPr.exists() ? bodyPr : undefined,
    listStyle: lstStyle.exists() ? lstStyle : undefined,
    paragraphs,
  }
}

/** Fill type local names in priority order. */
const FILL_TYPES = ['solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill', 'noFill'] as const

/**
 * Find the first fill element in a shape properties node.
 */
function findFill(spPr: SafeXmlNode): SafeXmlNode | undefined {
  for (const fillType of FILL_TYPES) {
    const fill = spPr.child(fillType)
    if (fill.exists()) return fill
  }
  return undefined
}

/**
 * Parse adjustment values from `a:avLst > a:gd` elements.
 * Each guide has a `name` attribute and a `fmla` attribute like "val 50000".
 */
function parseAdjustments(avLst: SafeXmlNode): Map<string, number> {
  const adjustments = new Map<string, number>()
  for (const gd of avLst.children('gd')) {
    const name = gd.attr('name')
    const fmla = gd.attr('fmla') ?? ''
    if (!name) continue

    // fmla is typically "val NNNNN" — extract the numeric part
    const match = fmla.match(/val\s+(-?\d+)/)
    if (match) {
      adjustments.set(name, Number(match[1]))
    } else {
      // Try direct numeric value
      const num = Number(fmla)
      if (!Number.isNaN(num)) {
        adjustments.set(name, num)
      }
    }
  }
  return adjustments
}

/**
 * Parse a shape XML node (`p:sp` or `p:cxnSp`) into ShapeNodeData.
 */
export function parseShapeNode(spNode: SafeXmlNode): ShapeNodeData {
  const base = parseBaseProps(spNode)
  const spPr = spNode.child('spPr')

  // --- Preset geometry ---
  const prstGeom = spPr.child('prstGeom')
  const presetGeometry = prstGeom.attr('prst')
  const avLst = prstGeom.child('avLst')
  const adjustments = parseAdjustments(avLst)

  // --- Custom geometry ---
  const custGeom = spPr.child('custGeom')
  const customGeometry = custGeom.exists() ? custGeom : undefined

  // --- Fill ---
  const fill = findFill(spPr)

  // --- Line ---
  const ln = spPr.child('ln')
  const line = ln.exists() ? ln : undefined

  // --- Line end markers (arrowheads) ---
  let headEnd: LineEndInfo | undefined
  let tailEnd: LineEndInfo | undefined
  if (ln.exists()) {
    const headEndNode = ln.child('headEnd')
    if (headEndNode.exists()) {
      const t = headEndNode.attr('type')
      if (t && t !== 'none') {
        headEnd = { type: t, w: headEndNode.attr('w'), len: headEndNode.attr('len') }
      }
    }
    const tailEndNode = ln.child('tailEnd')
    if (tailEndNode.exists()) {
      const t = tailEndNode.attr('type')
      if (t && t !== 'none') {
        tailEnd = { type: t, w: tailEndNode.attr('w'), len: tailEndNode.attr('len') }
      }
    }
  }

  // --- Text body ---
  const txBody = spNode.child('txBody')
  const textBody = parseTextBody(txBody)

  // --- Text transform (diagram shapes: dsp:txXfrm gives text box position/size in same space as xfrm)
  let textBoxBounds: TextBoxBounds | undefined
  const txXfrm = spNode.child('txXfrm')
  if (txXfrm.exists()) {
    const txOff = txXfrm.child('off')
    const txExt = txXfrm.child('ext')
    const xfrm = spPr.child('xfrm')
    const off = xfrm.child('off')
    const ext = xfrm.child('ext')
    const shapeX = off.numAttr('x') ?? 0
    const shapeY = off.numAttr('y') ?? 0
    const shapeW = ext.numAttr('cx') ?? 0
    const shapeH = ext.numAttr('cy') ?? 0
    const txX = txOff.numAttr('x') ?? 0
    const txY = txOff.numAttr('y') ?? 0
    const txW = txExt.numAttr('cx') ?? 0
    const txH = txExt.numAttr('cy') ?? 0
    if (shapeW > 0 && shapeH > 0) {
      const txRotDeg = angleToDeg(txXfrm.numAttr('rot') ?? 0)
      const localX = txX - shapeX
      const localY = txY - shapeY
      // For 180deg txXfrm, mirror text box placement inside shape-local coordinates.
      // (Common in SmartArt where shape xfrm also rotates by 180deg but text should remain upright.)
      const isHalfTurn = Math.abs(Math.round(txRotDeg)) % 360 === 180
      const boxX = isHalfTurn ? shapeW - (localX + txW) : localX
      const boxY = isHalfTurn ? shapeH - (localY + txH) : localY
      textBoxBounds = {
        x: emuToPx(boxX),
        y: emuToPx(boxY),
        w: emuToPx(txW),
        h: emuToPx(txH),
        rotation: txRotDeg,
      }
    }
  }

  return {
    ...base,
    nodeType: 'shape',
    presetGeometry,
    adjustments,
    customGeometry,
    fill,
    line,
    headEnd,
    tailEnd,
    textBody,
    textBoxBounds,
  }
}
